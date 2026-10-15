import { useSyncExternalStore } from 'react';

export type SyncStatus = 'saved' | 'saving' | 'syncing' | 'offline' | 'error' | 'local';

export interface SyncState {
  status: SyncStatus;
  pending: number;
  message?: string;
  lastSyncAt?: string;
}

let state: SyncState = { status: 'local', pending: 0 };
const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();
let savedTimer: ReturnType<typeof setTimeout> | undefined;
let baseStatus: SyncStatus = 'local';

export function getSyncState() {
  return state;
}

export function setSyncState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  if (patch.status && patch.status !== 'saving') baseStatus = patch.status;
  listeners.forEach((l) => l());
}

export function subscribeSync(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSyncState() {
  return useSyncExternalStore(subscribeSync, getSyncState);
}

/** repo가 로컬 저장을 끝낼 때마다 호출한다. 잠깐 "저장 중"을 보여주고 동기화 엔진에 알린다. */
export function notifyLocalChange() {
  if (state.status !== 'syncing') {
    state = { ...state, status: 'saving' };
    listeners.forEach((l) => l());
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      if (state.status === 'saving') setSyncState({ status: navigator.onLine ? baseStatus : 'offline' });
    }, 450);
  }
  changeListeners.forEach((l) => l());
}

export function onLocalChange(l: () => void) {
  changeListeners.add(l);
  return () => changeListeners.delete(l);
}
