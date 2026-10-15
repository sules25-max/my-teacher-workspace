import type { SyncTable } from '../../types';
import { callAppsScript, type AppsScriptConfig } from '../google/appsScriptClient';

export interface SyncChange {
  table: SyncTable | 'settings';
  op: 'upsert' | 'delete';
  id: string;
  updatedAt: string;
  record?: Record<string, unknown>;
}

export interface PullResult {
  changes: SyncChange[];
  serverTime: string;
}

export interface AttachmentUpload {
  id: string;
  name: string;
  mimeType: string;
  kind: string;
  base64: string;
}

/** 백엔드 교체가 가능하도록 동기화는 이 인터페이스만 사용한다. */
export interface SyncAdapter {
  readonly id: string;
  ping(): Promise<{ ok: boolean; spreadsheetUrl?: string }>;
  push(changes: SyncChange[]): Promise<void>;
  pull(since?: string): Promise<PullResult>;
  uploadAttachment(file: AttachmentUpload): Promise<{ fileId: string }>;
  downloadAttachment(fileId: string): Promise<{ base64: string; mimeType: string }>;
  createBackup(json: string, name: string): Promise<{ fileId: string; url?: string }>;
}

export class AppsScriptSyncAdapter implements SyncAdapter {
  readonly id = 'appsScript';
  constructor(private cfg: AppsScriptConfig) {}

  ping() {
    return callAppsScript<{ ok: boolean; spreadsheetUrl?: string }>('ping', {}, this.cfg, 15000);
  }
  async push(changes: SyncChange[]) {
    await callAppsScript('syncRecords', { push: changes }, this.cfg, 60000);
  }
  pull(since?: string) {
    return callAppsScript<PullResult>('pullChanges', { since }, this.cfg, 60000);
  }
  uploadAttachment(file: AttachmentUpload) {
    return callAppsScript<{ fileId: string }>('uploadAttachment', file, this.cfg, 120000);
  }
  downloadAttachment(fileId: string) {
    return callAppsScript<{ base64: string; mimeType: string }>('getAttachment', { fileId }, this.cfg, 120000);
  }
  createBackup(json: string, name: string) {
    return callAppsScript<{ fileId: string; url?: string }>('createBackup', { json, name }, this.cfg, 120000);
  }
}

/** Google 연결 전에도 앱이 그대로 동작하도록 하는 로컬 전용 구현. */
export class LocalOnlyAdapter implements SyncAdapter {
  readonly id = 'local';
  async ping() {
    return { ok: false };
  }
  async push() {}
  async pull() {
    return { changes: [], serverTime: new Date().toISOString() };
  }
  async uploadAttachment(): Promise<{ fileId: string }> {
    throw new Error('로컬 모드에서는 업로드하지 않아요.');
  }
  async downloadAttachment(): Promise<{ base64: string; mimeType: string }> {
    throw new Error('로컬 모드');
  }
  async createBackup(): Promise<{ fileId: string }> {
    throw new Error('Google 동기화를 먼저 연결해 주세요.');
  }
}
