import * as repo from './repo';
import type { Task } from '../types';
import { addDays, extractDate, isoWeekday, todayISO } from '../utils/date';

export type TaskBucket = 'overdue' | 'today' | 'week' | 'later' | 'done';

export function taskBucket(t: Task, today = todayISO()): TaskBucket {
  if (t.completed) return 'done';
  if (!t.dueDate) return 'later';
  if (t.dueDate < today) return 'overdue';
  if (t.dueDate === today) return 'today';
  const endOfWeek = addDays(today, 7 - isoWeekday(today));
  return t.dueDate <= endOfWeek ? 'week' : 'later';
}

export const BUCKET_LABEL: Record<TaskBucket, string> = {
  overdue: '기한 지남',
  today: '오늘',
  week: '이번 주',
  later: '나중에',
  done: '완료',
};

export function sortTasks(a: Task, b: Task) {
  if (!!a.important !== !!b.important) return a.important ? -1 : 1;
  if ((a.dueDate ?? '9999') !== (b.dueDate ?? '9999')) return (a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

export async function addTask(input: Partial<Task> & { title: string }): Promise<Task> {
  return repo.create<Task>('tasks', { completed: false, ...input, title: input.title.trim() });
}

export async function toggleTask(t: Task) {
  await repo.update<Task>('tasks', t.id, { completed: !t.completed, completedAt: t.completed ? undefined : new Date().toISOString() });
}

/** "10월 22일까지 활동지 제출" → { title: "활동지 제출", dueDate: "2026-10-22" } */
export function parseTaskText(text: string, base = todayISO()): { title: string; dueDate?: string } {
  const cleaned = text.replace(/^\s*([-•·*□☐▢]|\d+[.)])\s*/, '').trim();
  const { date, rest } = extractDate(cleaned, base);
  const title = rest.replace(/^(까지|은|는)\s*/, '').replace(/\s*(까지)$/, '').trim() || cleaned;
  return { title, dueDate: date };
}
