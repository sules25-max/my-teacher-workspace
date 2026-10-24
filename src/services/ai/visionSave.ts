import * as repo from '../repo';
import { db } from '../localDb';
import { addFiles } from '../attachments';
import { addTask } from '../tasks';
import { createPage } from '../pages';
import { createLessonRecord, effectiveSlot, loadOverrides, periodLabel } from '../planner';
import type { CalendarEvent, InkDoc, LessonRecord, MeetingNote, Note, Settings } from '../../types';
import { todayISO } from '../../utils/date';
import { uuid } from '../../utils/id';
import type { PreparedImage, VisionResult } from './vision';

// 이미지 분석 결과를 업무수첩에 저장하는 함수들. 모두 사용자가 미리보기를 확인한 뒤에만 호출된다.
// 원본 이미지는 기존 첨부 구조(addFiles → IndexedDB Blob → Drive 동기화)로 저장한다.

async function saveOriginals(images: PreparedImage[], owner: { type: string; id: string }) {
  return addFiles(images.map((i) => i.file), owner);
}

export async function saveTodos(items: { title: string; due?: string | null }[], label: string) {
  for (const t of items) await addTask({ title: t.title, dueDate: t.due ?? undefined, sourceType: 'assistant', sourceLabel: label });
}

export async function saveEvents(items: { title: string; date?: string | null; time?: string | null }[], memo: string) {
  for (const e of items) {
    await repo.create<CalendarEvent>('events', { date: e.date ?? todayISO(), time: e.time ?? undefined, title: e.title, category: 'work', memo, attachments: [] });
  }
}

export interface LessonTargetOption {
  key: string;
  label: string;
  date: string;
  periodId: string;
  classKey: string;
  recordId?: string;
}

/** 오늘 수업 칸(기록이 있거나 시간표에 있는 칸) */
export async function todayLessonTargets(s: Settings): Promise<LessonTargetOption[]> {
  const date = todayISO();
  const recs = await db.lessons.where('date').equals(date).toArray();
  const ov = await loadOverrides(date, date);
  const out: LessonTargetOption[] = [];
  for (const p of s.periods) {
    const rec = recs.find((r) => r.periodId === p.id);
    const cls = rec?.classKey ?? effectiveSlot(s, date, p.id, ov).classKey;
    if (!cls) continue;
    out.push({ key: `${date}:${p.id}`, label: `${periodLabel(s, p.id)} ${cls}${rec?.lesson ? ` · ${rec.lesson} ${rec.session}차시` : ''}`, date, periodId: p.id, classKey: cls, recordId: rec?.id });
  }
  return out;
}

/** 수업 기록의 메모 끝에 덧붙인다(기존 메모는 지우지 않음) */
export async function saveToLesson(s: Settings, t: LessonTargetOption, text: string) {
  const rec = t.recordId ? await db.lessons.get(t.recordId) : undefined;
  const add = `[이미지에서 정리] ${text}`;
  if (rec) await repo.update<LessonRecord>('lessons', rec.id, { memo: rec.memo?.trim() ? `${rec.memo}\n${add}` : add });
  else await createLessonRecord(s, t.date, t.periodId, t.classKey, { memo: add });
}

export async function saveMeeting(v: VisionResult, images: PreparedImage[], title: string) {
  const id = uuid();
  const atts = await saveOriginals(images, { type: 'meeting', id });
  await repo.create<MeetingNote>('meetings', {
    id,
    title,
    kind: '기타',
    date: todayISO(),
    announcements: '',
    decisions: '',
    todos: v.extract.todos.map((t) => `- ${t.title}${t.due ? ` (${t.due})` : ''}`).join('\n'),
    memo: v.text,
    attachments: atts.map((a) => a.id),
  });
  return id;
}

/** 새 자유보드를 만들고 원본 사진을 붙인다(그 위에 Pencil로 필기 가능) */
export async function saveBoard(images: PreparedImage[], title: string) {
  const page = await createPage(title, 'board');
  const block = page.blocks.find((b) => b.type === 'ink');
  if (!block || block.type !== 'ink') return page.id;
  const doc = await db.inkDocs.get(block.docId);
  if (!doc) return page.id;
  const atts = await saveOriginals(images, { type: 'inkDoc', id: doc.id });
  let y = 60;
  const placed = atts.map((a, i) => {
    const img = images[i];
    const w = Math.min(doc.width * 0.6, 900);
    const h = Math.round((w / img.width) * img.height);
    const item = { id: uuid(), attachmentId: a.id, x: 60 + i * 30, y, w: Math.round(w), h };
    y += h + 40;
    return item;
  });
  await repo.put<InkDoc>('inkDocs', { ...doc, images: [...doc.images, ...placed], height: Math.max(doc.height, y + 100) });
  return page.id;
}

export async function saveInbox(v: VisionResult, images: PreparedImage[], question: string) {
  const id = uuid();
  const atts = await saveOriginals(images, { type: 'inbox', id });
  await repo.create<Note>('notes', { id, kind: 'inbox', date: todayISO(), title: question.slice(0, 60) || '이미지 분석', text: v.text, attachments: atts.map((a) => a.id) });
  return id;
}
