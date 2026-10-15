import { db } from '../localDb';
import { createDefaultSettings } from '../../data/defaults';
import { AppsScriptSyncAdapter } from './adapter';
import { runSync } from './syncEngine';
import type { ConnectInfo } from './connectLink';

/**
 * 이 기기를 Google 동기화에 연결하고 클라우드 수첩을 내려받는다.
 * 처음 연결하는 기기는 클라우드의 설정(학년·시간표·커리큘럼 등)을 그대로 받아온다.
 */
export async function connectThisDevice(info: ConnectInfo): Promise<{ spreadsheetUrl?: string }> {
  const ping = await new AppsScriptSyncAdapter(info).ping();
  const cur = (await db.settings.get('main')) ?? createDefaultSettings();
  await db.settings.put({
    ...cur,
    sync: { ...cur.sync, mode: 'appsScript', endpoint: info.endpoint, token: info.token, lastSyncAt: undefined, autoSync: true },
  });
  await runSync();
  return { spreadsheetUrl: ping.spreadsheetUrl };
}
