import type { Table } from 'dexie';
import { db } from './localDb';
import * as repo from './repo';
import type { InkDoc, PageBlock, Settings, SyncTable, WorkspacePage } from '../types';
import { blobToBase64, base64ToBlob } from './google/appsScriptClient';
import { nowISO, uuid } from '../utils/id';
import { createInkDoc } from './attachments';
import { notifyLocalChange } from './sync/syncStatus';

// 전체 워크스페이스 JSON 내보내기 / 가져오기 / 학년도 복제

const TABLES: SyncTable[] = ['lessons', 'progress', 'events', 'tasks', 'notes', 'meetings', 'pages', 'pageGroups', 'inkDocs', 'attachments'];

export interface WorkspaceExport {
  app: 'my-teacher-workspace';
  version: 1;
  exportedAt: string;
  settings: Omit<Settings, 'sync'>;
  tables: Partial<Record<SyncTable, Record<string, unknown>[]>>;
}

export async function exportWorkspace(includeFiles = true): Promise<WorkspaceExport> {
  const s = await db.settings.get('main');
  const tables: WorkspaceExport['tables'] = {};
  for (const t of TABLES) {
    const rows = (await (db.table(t) as Table<Record<string, unknown>, string>).toArray()) as Record<string, unknown>[];
    if (t === 'attachments') {
      tables[t] = await Promise.all(
        rows.map(async (r) => {
          const { blob, ...rest } = r as { blob?: Blob } & Record<string, unknown>;
          return includeFiles && blob ? { ...rest, blobBase64: await blobToBase64(blob) } : rest;
        }),
      );
    } else tables[t] = rows;
  }
  const { sync: _sync, ...settings } = s!;
  void _sync;
  return { app: 'my-teacher-workspace', version: 1, exportedAt: nowISO(), settings, tables };
}

export function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function backupFileName(prefix = 'teacher-workspace') {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

export function validateExport(x: unknown): x is WorkspaceExport {
  const e = x as WorkspaceExport;
  return !!e && e.app === 'my-teacher-workspace' && typeof e.tables === 'object' && !!e.settings;
}

/** mode=replace: 기기 데이터를 모두 지우고 파일 내용으로 바꾼다. merge: 같은 id는 더 최근 것을 남긴다. */
export async function importWorkspace(data: WorkspaceExport, mode: 'replace' | 'merge') {
  const local = await db.settings.get('main');
  await db.transaction('rw', [db.settings, db.syncQueue, ...TABLES.map((t) => db.table(t))], async () => {
    if (mode === 'replace') for (const t of TABLES) await db.table(t).clear();
    for (const t of TABLES) {
      const rows = data.tables[t] ?? [];
      const table = db.table(t) as Table<Record<string, unknown> & { id: string; updatedAt: string }, string>;
      for (const raw of rows) {
        const r = { ...raw } as Record<string, unknown> & { id: string; updatedAt: string; blobBase64?: string; mimeType?: string };
        if (t === 'attachments' && r.blobBase64) {
          r.blob = base64ToBlob(r.blobBase64, r.mimeType ?? 'application/octet-stream');
          delete r.blobBase64;
        }
        if (mode === 'merge') {
          const cur = await table.get(r.id);
          if (cur && cur.updatedAt >= r.updatedAt) continue;
        }
        await table.put(r);
        await db.syncQueue.put({ key: `${t}:${r.id}`, table: t, recordId: r.id, op: 'upsert', at: nowISO(), tries: 0 });
      }
    }
    await db.settings.put({ ...(data.settings as Settings), id: 'main', setupDone: true, sync: local?.sync ?? (data.settings as Settings).sync });
  });
  notifyLocalChange();
}

function emptyBlock(b: PageBlock): PageBlock {
  if (b.type === 'text' || b.type === 'heading') return { ...b, id: uuid(), text: '' };
  if (b.type === 'checklist') return { ...b, id: uuid(), items: [] };
  return b;
}

/**
 * 새 학년도 시작: 페이지 구조·그룹·시간표·커리큘럼은 유지하고 내용은 비운 복사본을 만든다.
 * 수업 기록 · 진도 · 할 일은 복제하지 않는다(이전 학년 기록은 보관함에서 연도별로 볼 수 있음).
 */
export async function startNewAcademicYear(opts: { copyPages: boolean; archiveOldPages: boolean; keepTimetable: boolean }) {
  const s = (await db.settings.get('main'))!;
  const next = s.academicYear + 1;
  const pages = await db.pages.filter((p) => !p.archived).toArray();
  if (opts.copyPages) {
    for (const p of pages) {
      const blocks: PageBlock[] = [];
      for (const b of p.blocks) {
        if (b.type === 'ink') {
          const old = await db.inkDocs.get(b.docId);
          const d: InkDoc = await createInkDoc(old?.background ?? 'plain', old?.width ?? 1200, old?.height ?? 1600);
          blocks.push({ id: uuid(), type: 'ink', docId: d.id });
        } else blocks.push(emptyBlock(b));
      }
      await repo.create<WorkspacePage>('pages', { title: p.title.replace(String(s.academicYear), String(next)), template: p.template, groupId: p.groupId, order: p.order, blocks });
    }
  }
  if (opts.archiveOldPages) for (const p of pages) await repo.update<WorkspacePage>('pages', p.id, { archived: true });
  await repo.saveSettings({
    academicYear: next,
    timetable: opts.keepTimetable ? s.timetable : {},
    semesters: [
      { id: `${next}-1`, label: `${next} 1학기`, start: `${next}-03-01`, end: `${next}-08-15` },
      { id: `${next}-2`, label: `${next} 2학기`, start: `${next}-08-16`, end: `${next + 1}-02-28` },
    ],
  });
}

/** 다른 기기에서 새 수첩을 시작할 때 쓸 수 있도록 구조만 담은 JSON을 만든다. */
export async function exportStructureOnly(): Promise<WorkspaceExport> {
  const full = await exportWorkspace(false);
  const pages = (full.tables.pages ?? []) as unknown as WorkspacePage[];
  return {
    ...full,
    settings: { ...full.settings, setupDone: true },
    tables: {
      pageGroups: full.tables.pageGroups,
      pages: pages.filter((p) => !p.archived).map((p) => ({ ...p, blocks: p.blocks.filter((b) => b.type !== 'ink').map(emptyBlock) })) as unknown as Record<string, unknown>[],
    },
  };
}
