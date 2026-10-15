import { db } from './localDb';
import * as repo from './repo';
import type { CurriculumLesson, LessonRecord, PeriodSlot, ProgressEntry, Settings } from '../types';
import { classKey, parseClassKey, uuid } from '../utils/id';
import { WEEKDAY_KO, dateOfWeekday, isoWeekday, startOfWeek } from '../utils/date';

// 시간표 · 진도 · 수업 기록을 서로 연결하는 도메인 로직.

export interface ClassInfo {
  key: string;
  grade: number;
  classNumber: number;
}

export function allClasses(s: Settings): ClassInfo[] {
  return s.grades.flatMap((g) =>
    Array.from({ length: s.classesPerGrade[String(g)] ?? 0 }, (_, i) => ({
      key: classKey(g, i + 1),
      grade: g,
      classNumber: i + 1,
    })),
  );
}

export function classesOfGrade(s: Settings, grade: number): ClassInfo[] {
  return allClasses(s).filter((c) => c.grade === grade);
}

export function periodAllowsGrade(p: PeriodSlot, grade: number): boolean {
  return !p.grades?.length || p.grades.includes(grade);
}

export const slotKey = (weekday: number, periodId: string) => `${weekday}:${periodId}`;

export function periodIndex(s: Settings, periodId: string): number {
  return s.periods.findIndex((p) => p.id === periodId) + 1;
}

export function periodLabel(s: Settings, periodId: string): string {
  return s.periods.find((p) => p.id === periodId)?.short ?? '';
}

export function curriculumFor(s: Settings, grade: number): CurriculumLesson[] {
  return s.curriculum[String(grade)] ?? [];
}

/** (lessonId, session)을 커리큘럼 안의 순번(0부터)으로 바꾼다. */
export function seqIndex(curr: CurriculumLesson[], lessonId: string | undefined, session: number): number {
  let idx = 0;
  for (const l of curr) {
    if (l.id === lessonId) return session >= 1 && session <= l.sessions ? idx + session - 1 : -1;
    idx += l.sessions;
  }
  return -1;
}

export function seqToLesson(curr: CurriculumLesson[], seq: number): { lesson: CurriculumLesson; session: number } | null {
  let idx = 0;
  for (const l of curr) {
    if (seq < idx + l.sessions) return { lesson: l, session: seq - idx + 1 };
    idx += l.sessions;
  }
  return null;
}

export interface Suggestion {
  lessonId: string;
  lesson: string;
  title?: string;
  session: number;
  totalSessions: number;
}

function toSuggestion(curr: CurriculumLesson[], seq: number): Suggestion | null {
  const r = seqToLesson(curr, seq);
  if (!r) return null;
  return { lessonId: r.lesson.id, lesson: r.lesson.name, title: r.lesson.title, session: r.session, totalSessions: r.lesson.sessions };
}

export interface ClassProgress {
  key: string;
  grade: number;
  classNumber: number;
  done: number;
  total: number;
  furthest: number; // 가장 멀리 나간 순번, 없으면 -1
  next: Suggestion | null;
}

/** 현재 학년도(학기 설정의 처음~끝) 범위. 새 학년도가 되면 진도는 0부터 다시 센다. */
export function academicRange(s: Settings): { start: string; end: string } {
  const starts = s.semesters.map((x) => x.start).sort();
  const ends = s.semesters.map((x) => x.end).sort();
  return { start: starts[0] ?? `${s.academicYear}-03-01`, end: ends[ends.length - 1] ?? `${s.academicYear + 1}-02-28` };
}

export function inAcademicYear(s: Settings, date: string): boolean {
  const r = academicRange(s);
  return date >= r.start && date <= r.end;
}

export function computeClassProgress(s: Settings, cls: ClassInfo, entries: ProgressEntry[]): ClassProgress {
  const curr = curriculumFor(s, cls.grade);
  const mine = entries.filter((e) => e.classKey === cls.key && inAcademicYear(s, e.date));
  const seqs = new Set<number>();
  for (const e of mine) {
    const i = seqIndex(curr, e.lessonId, e.session);
    if (i >= 0) seqs.add(i);
  }
  const furthest = seqs.size ? Math.max(...seqs) : -1;
  return {
    key: cls.key,
    grade: cls.grade,
    classNumber: cls.classNumber,
    done: seqs.size,
    total: s.totalSessions,
    furthest,
    next: toSuggestion(curr, furthest + 1),
  };
}

export type LessonCellStatus = 'done' | 'partial' | 'none';

export function lessonStatus(lesson: CurriculumLesson, classKeyValue: string, entries: ProgressEntry[], s?: Settings): { status: LessonCellStatus; count: number } {
  const done = new Set(entries.filter((e) => e.classKey === classKeyValue && e.lessonId === lesson.id && (!s || inAcademicYear(s, e.date))).map((e) => e.session));
  const count = [...done].filter((n) => n >= 1 && n <= lesson.sessions).length;
  return { status: count === 0 ? 'none' : count >= lesson.sessions ? 'done' : 'partial', count };
}

/**
 * 다음 차시 제안: 진도표에 완료된 차시와, 이 수업보다 앞선 시간에 이미 계획된 수업을 모두 고려해
 * 그 다음 차시를 제안한다. 데이터를 바꾸지는 않는다.
 */
export async function suggestNextFor(s: Settings, cls: string, date: string, periodId: string): Promise<Suggestion | null> {
  const { grade } = parseClassKey(cls);
  const curr = curriculumFor(s, grade);
  const entries = await db.progress.where('classKey').equals(cls).toArray();
  const records = await db.lessons.where('classKey').equals(cls).toArray();
  const pIdx = periodIndex(s, periodId);
  let furthest = -1;
  for (const e of entries) if (inAcademicYear(s, e.date)) furthest = Math.max(furthest, seqIndex(curr, e.lessonId, e.session));
  for (const r of records) {
    if (!inAcademicYear(s, r.date)) continue;
    const before = r.date < date || (r.date === date && r.period < pIdx);
    if (before && r.lessonId) furthest = Math.max(furthest, seqIndex(curr, r.lessonId, r.session));
  }
  return toSuggestion(curr, furthest + 1);
}

export function emptyLessonFields() {
  return { lesson: '', session: 0, objective: '', activities: [], materials: [], memo: '', completed: false, attachments: [] };
}

export async function createLessonRecord(
  s: Settings,
  date: string,
  periodId: string,
  cls: string,
  fields: Partial<LessonRecord> = {},
): Promise<LessonRecord> {
  const { grade, classNumber } = parseClassKey(cls);
  return repo.create<LessonRecord>('lessons', {
    date,
    weekday: isoWeekday(date),
    periodId,
    period: periodIndex(s, periodId),
    grade,
    classNumber,
    classKey: cls,
    ...emptyLessonFields(),
    ...fields,
  });
}

export function applySuggestion(sug: Suggestion): Partial<LessonRecord> {
  return {
    lessonId: sug.lessonId,
    lesson: sug.lesson,
    session: sug.session,
    totalSessions: sug.totalSessions,
    objective: sug.title ?? '',
  };
}

/** 수업 완료 ↔ 진도표 연결. 완료하면 진도 기록을 만들고, 완료 취소하면 그 수업이 만든 진도 기록만 지운다. */
export async function setLessonCompleted(rec: LessonRecord, completed: boolean): Promise<{ progressChanged: boolean }> {
  await repo.update<LessonRecord>('lessons', rec.id, { completed, completedAt: completed ? new Date().toISOString() : undefined });
  if (!rec.lessonId || !rec.session) return { progressChanged: false };
  if (completed) {
    const exists = await db.progress
      .where('[classKey+lessonId+session]')
      .equals([rec.classKey, rec.lessonId, rec.session])
      .first();
    if (exists) return { progressChanged: false };
    await repo.create<ProgressEntry>('progress', {
      classKey: rec.classKey,
      grade: rec.grade,
      lessonId: rec.lessonId,
      lesson: rec.lesson,
      session: rec.session,
      date: rec.date,
      lessonRecordId: rec.id,
      source: 'lesson',
    });
    return { progressChanged: true };
  }
  const linked = await db.progress.where('lessonRecordId').equals(rec.id).toArray();
  for (const e of linked) await repo.remove('progress', e.id);
  return { progressChanged: linked.length > 0 };
}

export async function toggleProgressCell(s: Settings, cls: string, lesson: CurriculumLesson, session: number, date: string) {
  const existing = await db.progress.where('[classKey+lessonId+session]').equals([cls, lesson.id, session]).first();
  if (existing) {
    await repo.remove('progress', existing.id);
    return;
  }
  await repo.create<ProgressEntry>('progress', {
    classKey: cls,
    grade: parseClassKey(cls).grade,
    lessonId: lesson.id,
    lesson: lesson.name,
    session,
    date,
    source: 'manual',
  });
  void s;
}

// ---------- 다른 반으로 복사 ----------

export interface CopyTarget {
  classKey: string;
  date?: string;
  periodId?: string;
  slotLabel?: string;
  existing?: LessonRecord;
  willOverwrite: boolean;
}

/** 같은 주 시간표에서 대상 반의 수업 칸을 찾는다. 비어 있는 칸을 먼저 고른다. */
export async function findCopyTarget(s: Settings, source: LessonRecord, target: string): Promise<CopyTarget> {
  const weekStart = startOfWeek(source.date);
  const slots: { date: string; periodId: string; weekday: number }[] = [];
  for (const wd of s.weekdays) {
    for (const p of s.periods) {
      if (s.timetable[slotKey(wd, p.id)] === target) slots.push({ date: dateOfWeekday(weekStart, wd), periodId: p.id, weekday: wd });
    }
  }
  if (!slots.length) return { classKey: target, willOverwrite: false };
  const weekRecords = await db.lessons.where('classKey').equals(target).toArray();
  const at = (sl: (typeof slots)[number]) => weekRecords.find((r) => r.date === sl.date && r.periodId === sl.periodId);
  const free = slots.find((sl) => !at(sl)?.lesson);
  const chosen = free ?? slots[0];
  const existing = at(chosen);
  return {
    classKey: target,
    date: chosen.date,
    periodId: chosen.periodId,
    slotLabel: `${WEEKDAY_KO[chosen.weekday]} ${periodLabel(s, chosen.periodId)}`,
    existing,
    willOverwrite: !!existing?.lesson,
  };
}

/** 수업 내용만 복사하고 반별 메모·첨부·완료 여부는 각 반에 남긴다. */
export async function copyLesson(s: Settings, source: LessonRecord, t: CopyTarget): Promise<LessonRecord | null> {
  if (!t.date || !t.periodId) return null;
  const content: Partial<LessonRecord> = {
    lessonId: source.lessonId,
    lesson: source.lesson,
    session: source.session,
    totalSessions: source.totalSessions,
    objective: source.objective,
    activities: source.activities.map((a) => ({ ...a, id: uuid(), done: false })),
    materials: source.materials.map((a) => ({ ...a, id: uuid(), done: false })),
    copiedFrom: source.id,
  };
  if (t.existing) {
    await repo.update<LessonRecord>('lessons', t.existing.id, content);
    return { ...t.existing, ...content };
  }
  return createLessonRecord(s, t.date, t.periodId, t.classKey, content);
}

export function classLabel(key: string): string {
  const { grade, classNumber } = parseClassKey(key);
  return `${grade}학년 ${classNumber}반`;
}

/** 학기 중간에 시작할 때: 커리큘럼 처음부터 (lessonId, session)까지 빠진 차시를 모두 완료로 기록한다. */
export async function markProgressUpTo(s: Settings, cls: string, lessonId: string, session: number, date: string): Promise<number> {
  const { grade } = parseClassKey(cls);
  const curr = curriculumFor(s, grade);
  const last = seqIndex(curr, lessonId, session);
  if (last < 0) return 0;
  const existing = await db.progress.where('classKey').equals(cls).toArray();
  const have = new Set(existing.filter((e) => inAcademicYear(s, e.date)).map((e) => seqIndex(curr, e.lessonId, e.session)));
  const items: Omit<ProgressEntry, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  for (let i = 0; i <= last; i++) {
    if (have.has(i)) continue;
    const r = seqToLesson(curr, i)!;
    items.push({ classKey: cls, grade, lessonId: r.lesson.id, lesson: r.lesson.name, session: r.session, date, source: 'manual' });
  }
  if (items.length) await repo.bulkCreate<ProgressEntry>('progress', items);
  return items.length;
}
