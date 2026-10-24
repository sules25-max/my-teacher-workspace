import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { flushAllPending } from './flush';

// 앱(서비스 워커) 업데이트 관리. 새 버전은 자동으로 새로고침하지 않고,
// 사용자가 [적용]을 누르면 입력 중인 내용을 먼저 저장한 뒤 바꾼다.

declare const __BUILD_TIME__: string;
export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'dev';

let needRefresh = false;
const ls = new Set<() => void>();
const emit = () => ls.forEach((l) => l());
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | undefined;

export function initAppUpdate(onNeed: () => void) {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      emit();
      onNeed();
    },
    onRegisteredSW(_url, r) {
      registration = r;
    },
  });
}

export async function applyUpdate() {
  (document.activeElement as HTMLElement | null)?.blur?.();
  await flushAllPending();
  await new Promise((r) => setTimeout(r, 500)); // IndexedDB 쓰기가 끝날 시간
  if (updateSW) await updateSW(true);
  else location.reload();
}

/** 서버에 새 버전이 있는지 확인한다. 이미 받아 둔 새 버전이 기다리고 있으면 true */
export async function checkForUpdate(): Promise<'ready' | 'latest' | 'offline' | 'unsupported'> {
  if (!navigator.onLine) return 'offline';
  if (!registration) return 'unsupported';
  await registration.update();
  await new Promise((r) => setTimeout(r, 1500));
  if (registration.waiting) {
    needRefresh = true;
    emit();
    return 'ready';
  }
  return needRefresh ? 'ready' : 'latest';
}

export function useNeedRefresh() {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => needRefresh,
  );
}
