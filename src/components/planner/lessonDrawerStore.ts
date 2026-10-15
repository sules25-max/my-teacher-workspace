import { useSyncExternalStore } from 'react';

/** 어느 화면에서든 수업 카드를 열 수 있도록 하는 전역 상태 */
export type LessonTarget = { recordId: string } | { date: string; periodId: string; classKey?: string };

let target: LessonTarget | null = null;
const ls = new Set<() => void>();

export function openLesson(t: LessonTarget) {
  target = t;
  ls.forEach((l) => l());
}

export function closeLesson() {
  target = null;
  ls.forEach((l) => l());
}

export function useLessonTarget() {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => target,
  );
}
