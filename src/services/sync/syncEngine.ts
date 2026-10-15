import type { Table } from 'dexie';
import { db } from '../localDb';
import type { Attachment, Settings, SyncTable } from '../../types';
import { AppsScriptSyncAdapter, type SyncAdapter, type SyncChange } from './adapter';
import { getAppsScriptConfig, blobToBase64, base64ToBlob } from '../google/appsScriptClient';
import { onLocalChange, setSyncState } from './syncStatus';

// 입력 → IndexedDB 저장 → UI 즉시 반영 → (여기) 백그라운드 동기화 → Google
// 충돌은 레코드 단위 last-write-wins(updatedAt)로 처리하고,
// 아직 올라가지 않은 로컬 변경이 있는 레코드는 서버 값으로 덮어쓰지 않는다.

const SYNC_TABLES: SyncTable[] = [
  'slotOverrides',
  'lessons',
  'progress',
  'events',
  'tasks',
  'notes',
  'meetings',
  'pages',
  'pageGroups',
  'inkDocs',
  'attachments',
];

let running = false;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function getAdapter(): Promise<SyncAdapter | null> {
  const cfg = await getAppsScriptConfig();
  return cfg ? new AppsScriptSyncAdapter(cfg) : null;
}

export function scheduleSync(delay = 2500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void runSync(), delay);
}

async function pendingCount() {
  return db.syncQueue.count();
}

function stripSettings(s: Settings): Record<string, unknown> {
  // 토큰/엔드포인트 같은 기기 연결 정보는 클라우드로 보내지 않는다.
  const { sync: _sync, ...rest } = s;
  void _sync;
  return rest as unknown as Record<string, unknown>;
}

async function uploadPendingAttachments(adapter: SyncAdapter) {
  const pending = await db.attachments.filter((a) => !!a.blob && !a.driveFileId && a.kind !== 'link').toArray();
  for (const a of pending) {
    const base64 = await blobToBase64(a.blob!);
    const { fileId } = await adapter.uploadAttachment({ id: a.id, name: a.name, mimeType: a.mimeType, kind: a.kind, base64 });
    await db.transaction('rw', [db.attachments, db.syncQueue], async () => {
      await db.attachments.update(a.id, { driveFileId: fileId });
      await db.syncQueue.put({ key: `attachments:${a.id}`, table: 'attachments', recordId: a.id, op: 'upsert', at: new Date().toISOString(), tries: 0 });
    });
  }
}

async function pushQueue(adapter: SyncAdapter) {
  for (;;) {
    const items = await db.syncQueue.orderBy('at').limit(40).toArray();
    if (!items.length) return;
    const changes: SyncChange[] = [];
    for (const it of items) {
      if (it.op === 'delete') {
        changes.push({ table: it.table, op: 'delete', id: it.recordId, updatedAt: it.at });
        continue;
      }
      if (it.table === 'settings') {
        const s = await db.settings.get('main');
        if (s) changes.push({ table: 'settings', op: 'upsert', id: 'main', updatedAt: s.updatedAt, record: stripSettings(s) });
        continue;
      }
      const rec = (await (db.table(it.table) as Table<Record<string, unknown>, string>).get(it.recordId)) as
        | (Record<string, unknown> & { updatedAt: string })
        | undefined;
      if (!rec) continue;
      const { blob: _blob, ...clean } = rec;
      void _blob;
      changes.push({ table: it.table, op: 'upsert', id: it.recordId, updatedAt: rec.updatedAt, record: clean });
    }
    await adapter.push(changes);
    // 업로드 도중 다시 수정된 항목은 큐에 남겨 다음 회차에 올린다.
    await db.transaction('rw', db.syncQueue, async () => {
      for (const it of items) {
        const cur = await db.syncQueue.get(it.key);
        if (cur && cur.at === it.at) await db.syncQueue.delete(it.key);
      }
    });
  }
}

async function applyPull(adapter: SyncAdapter, since?: string): Promise<{ serverTime: string; gotSettings: boolean }> {
  const { changes, serverTime } = await adapter.pull(since);
  const first = !since; // 이 기기의 첫 동기화: 클라우드 설정을 그대로 받아온다
  let gotSettings = false;
  for (const ch of changes) {
    const key = `${ch.table}:${ch.id}`;
    if (ch.table === 'settings' && ch.record) gotSettings = true;
    if (await db.syncQueue.get(key)) continue; // 로컬 변경이 아직 올라가지 않음 → 로컬 우선
    if (ch.table === 'settings') {
      const local = await db.settings.get('main');
      if (local && ch.record && (first || (ch.record.updatedAt as string) > local.updatedAt)) {
        await db.settings.put({ ...(ch.record as unknown as Settings), id: 'main', setupDone: true, sync: local.sync });
      }
      continue;
    }
    if (!SYNC_TABLES.includes(ch.table)) continue;
    const t = db.table(ch.table) as Table<Record<string, unknown>, string>;
    if (ch.op === 'delete') {
      await t.delete(ch.id);
      continue;
    }
    const local = (await t.get(ch.id)) as (Record<string, unknown> & { updatedAt: string }) | undefined;
    if (local && local.updatedAt >= ch.updatedAt) continue;
    const next = { ...ch.record, id: ch.id };
    if (ch.table === 'attachments' && local?.blob) (next as Partial<Attachment>).blob = local.blob as Blob;
    await t.put(next);
  }
  return { serverTime, gotSettings };
}

export async function runSync(): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    const adapter = await getAdapter();
    const pending = await pendingCount();
    if (!adapter) {
      setSyncState({ status: 'local', pending, message: '기기에만 저장 중' });
      return;
    }
    if (!navigator.onLine) {
      setSyncState({ status: 'offline', pending, message: '오프라인 · 연결되면 자동 동기화' });
      return;
    }
    setSyncState({ status: 'syncing', pending });
    const before = await db.settings.get('main');
    const firstSync = !before?.sync.lastSyncAt;
    // 새로 연결한 기기는 자기 설정으로 클라우드 설정을 덮어쓰지 않는다(클라우드 설정을 먼저 받는다)
    if (firstSync) await db.syncQueue.delete('settings:main');
    await uploadPendingAttachments(adapter);
    await pushQueue(adapter);
    const { serverTime, gotSettings } = await applyPull(adapter, before?.sync.lastSyncAt);
    const settings = await db.settings.get('main');
    if (settings) {
      // lastSyncAt은 기기 상태이므로 큐에 넣지 않고 직접 저장한다.
      await db.settings.update('main', { sync: { ...settings.sync, lastSyncAt: serverTime } });
    }
    if (firstSync && !gotSettings && settings?.setupDone) {
      // 클라우드가 비어 있으면(첫 번째 기기) 이 기기 설정을 올려 다른 기기가 받을 수 있게 한다
      await db.syncQueue.put({ key: 'settings:main', table: 'settings', recordId: 'main', op: 'upsert', at: new Date().toISOString(), tries: 0 });
      rerun = true;
    }
    setSyncState({ status: 'saved', pending: await pendingCount(), lastSyncAt: serverTime, message: undefined });
  } catch (e) {
    setSyncState({ status: 'error', pending: await pendingCount(), message: (e as Error).message });
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      scheduleSync(1000);
    }
  }
}

/** 원격에만 있는 첨부(다른 기기에서 올린 사진 등)를 필요할 때 내려받는다. */
export async function ensureAttachmentBlob(att: Attachment): Promise<Blob | undefined> {
  if (att.blob) return att.blob;
  if (!att.driveFileId) return undefined;
  const adapter = await getAdapter();
  if (!adapter || !navigator.onLine) return undefined;
  const { base64, mimeType } = await adapter.downloadAttachment(att.driveFileId);
  const blob = base64ToBlob(base64, mimeType || att.mimeType);
  await db.attachments.update(att.id, { blob });
  return blob;
}

export async function getSyncAdapter() {
  return getAdapter();
}

let started = false;
export function startSyncEngine() {
  if (started) return;
  started = true;
  onLocalChange(() => scheduleSync(2500));
  window.addEventListener('online', () => scheduleSync(300));
  window.addEventListener('offline', async () =>
    setSyncState({ status: 'offline', pending: await pendingCount(), message: '오프라인 · 기기에 저장 중' }),
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(500);
  });
  setInterval(() => scheduleSync(0), 120000);
  scheduleSync(800);
}
