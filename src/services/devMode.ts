import { useSyncExternalStore } from 'react';

// 개발자 확인용 화면(AI가 실제로 검색 · 사용한 기록 목록 등)을 켜고 끄는 기기별 설정.
// 평소에는 꺼져 있고, 설정 → AI 비서 → "개발자 모드"에서 켠다. 사용자 데이터에는 저장하지 않는다.

const KEY = 'mtw.dev';
const ls = new Set<() => void>();

export function isDevMode(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setDevMode(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 무시 */
  }
  ls.forEach((l) => l());
}

export function useDevMode(): boolean {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    isDevMode,
  );
}
