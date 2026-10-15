import type { Table } from 'dexie';
import { db } from './localDb';
import type { BaseRecord, Settings, SyncTable } from '../types';
import { nowISO, uuid } from '../utils/id';
import { notifyLocalChange } from './sync/syncStatus';

// 모든 쓰기는 이 모듈을 통과한다: IndexedDB 저장 + 동기화 큐 등록을 한 트랜잭션으로 처리한다.

function table<T extends BaseRecord>(name: SyncTable): Table<T, string> {
  return db.table(name) as Table<T, string>;
}

async function enqueue(name: SyncTable | 'settings', recordId: string, op: 'upsert' | 'delete') {
  await db.syncQueue.put({ key: `${name}:${recordId}`, table: name, recordId, op, at: nowISO(), tries: 0 });
}

export async function create<T extends BaseRecord>(
  name: SyncTable,
  data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<BaseRecord>,
): Promise<T> {
  const now = nowISO();
  const rec = { ...data, id: data.id ?? uuid(), createdAt: data.createdAt ?? now, updatedAt: now } as T;
  await db.transaction('rw', [db.table(name), db.syncQueue], async () => {
    await table<T>(name).put(rec);
    await enqueue(name, rec.id, 'upsert');
  });
  notifyLocalChange();
  return rec;
}

export async function update<T extends BaseRecord>(name: SyncTable, id: string, changes: Partial<T>): Promise<void> {
  await db.transaction('rw', [db.table(name), db.syncQueue], async () => {
    await table<T>(name).update(id, { ...changes, updatedAt: nowISO() } as never);
    await enqueue(name, id, 'upsert');
  });
  notifyLocalChange();
}

export async function put<T extends BaseRecord>(name: SyncTable, rec: T): Promise<T> {
  const next = { ...rec, updatedAt: nowISO() };
  await db.transaction('rw', [db.table(name), db.syncQueue], async () => {
    await table<T>(name).put(next);
    await enqueue(name, rec.id, 'upsert');
  });
  notifyLocalChange();
  return next;
}

export async function remove(name: SyncTable, id: string): Promise<void> {
  await db.transaction('rw', [db.table(name), db.syncQueue, db.tombstones], async () => {
    await table(name).delete(id);
    await db.tombstones.put({ key: `${name}:${id}`, table: name, recordId: id, deletedAt: nowISO() });
    await enqueue(name, id, 'delete');
  });
  notifyLocalChange();
}

export async function bulkCreate<T extends BaseRecord>(
  name: SyncTable,
  items: (Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<BaseRecord>)[],
): Promise<T[]> {
  const now = nowISO();
  const recs = items.map((d) => ({ ...d, id: d.id ?? uuid(), createdAt: now, updatedAt: now }) as T);
  await db.transaction('rw', [db.table(name), db.syncQueue], async () => {
    await table<T>(name).bulkPut(recs);
    for (const r of recs) await enqueue(name, r.id, 'upsert');
  });
  notifyLocalChange();
  return recs;
}

export async function saveSettings(changes: Partial<Settings>): Promise<void> {
  await db.transaction('rw', [db.settings, db.syncQueue], async () => {
    await db.settings.update('main', { ...changes, updatedAt: nowISO() });
    await enqueue('settings', 'main', 'upsert');
  });
  notifyLocalChange();
}

/** 현재 저장된 설정을 기준으로 바꾼다. 빠르게 연달아 바꿔도 앞선 변경이 덮어써지지 않는다. */
export async function updateSettings(fn: (cur: Settings) => Partial<Settings>): Promise<void> {
  await db.transaction('rw', [db.settings, db.syncQueue], async () => {
    const cur = await db.settings.get('main');
    if (!cur) return;
    await db.settings.update('main', { ...fn(cur), updatedAt: nowISO() });
    await enqueue('settings', 'main', 'upsert');
  });
  notifyLocalChange();
}
