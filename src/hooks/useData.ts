import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/localDb';
import type { Settings } from '../types';
import { createDefaultSettings } from '../data/defaults';

const fallback = createDefaultSettings();

/** 설정은 거의 모든 화면이 쓰므로 하나의 훅으로 구독한다. */
export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get('main'), []) ?? fallback;
}

export function useSettingsLoaded(): Settings | undefined | null {
  return useLiveQuery(async () => (await db.settings.get('main')) ?? null, []);
}

export async function ensureSettings(): Promise<Settings> {
  const s = await db.settings.get('main');
  if (s) return s;
  const fresh = createDefaultSettings();
  await db.settings.put(fresh);
  return fresh;
}
