import { db } from '../localDb';
import * as repo from '../repo';
import type { AssistantExpression } from '../../components/assistant/sprite';
import type { LessonRecord, Settings, Task } from '../../types';
import { addDays, dateOfWeekday, formatShort, isoWeekday, relativeDue, startOfWeek, todayISO, WEEKDAY_KO } from '../../utils/date';
import { addTask, parseTaskText, taskBucket } from '../tasks';
import {
  allClasses,
  applySuggestion,
  computeClassProgress,
  createLessonRecord,
  inAcademicYear,
  periodLabel,
  setLessonCompleted,
  effectiveSlot,
  loadOverrides,
  suggestNextFor,
} from '../planner';
import type { Route } from '../../hooks/useRoute';
import { askWithRecords, NOT_FOUND, type AIDebug, type GroundedReply } from './grounded';
import type { PreparedImage, VisionResult } from './vision';

// AI 비서의 기본 동작은 기기 안에서 계산한다(외부 전송 없음).
// READ는 바로, WRITE/DELETE는 ProposedAction으로 돌려주고 사용자가 [반영]을 눌러야 실행된다.

export interface ProposedAction {
  id: string;
  kind: 'write' | 'delete';
  label: string; // 버튼 이름: "반영", "Tasks에 넣기"
  detail: string[]; // 무엇이 바뀌는지 미리보기
  run: () => Promise<string>; // 실행 후 비서가 할 말
}

export interface ReplyLink {
  label: string;
  href?: string;
  lessonId?: string;
}

export interface AssistantReply {
  text: string;
  expression: AssistantExpression;
  action?: ProposedAction;
  links?: ReplyLink[];
  footer?: string; // "관련 기록 7건 확인" · "총 43개 기록 중 43개 분석"
  debug?: AIDebug; // 개발자 모드에서만 보이는 검색 · 사용 기록
  vision?: { result: VisionResult; images: PreparedImage[]; question: string }; // 이미지 분석 결과(저장 액션용)
}

export type QuickActionId = 'daily' | 'week' | 'tasks' | 'meeting' | 'next' | 'lagging' | 'find' | 'ask';

export const QUICK_ACTIONS: { id: QuickActionId; label: string }[] = [
  { id: 'daily', label: '✨ 오늘 하루 정리' },
  { id: 'week', label: '이번 주 수업 정리' },
  { id: 'tasks', label: '미완료 업무 보기' },
  { id: 'meeting', label: '회의 메모 정리' },
  { id: 'next', label: '다음 차시 준비' },
  { id: 'lagging', label: '진도 늦은 반 찾기' },
  { id: 'find', label: '지난 메모 찾기' },
  { id: 'ask', label: '자유롭게 질문' },
];

let seq = 0;
const aid = () => `act-${++seq}`;

export async function weekSummary(): Promise<AssistantReply> {
  const today = todayISO();
  const ws = startOfWeek(today);
  const lessons = (await db.lessons.where('date').between(ws, addDays(ws, 6), true, true).toArray()).filter((l) => l.lesson);
  if (!lessons.length) return { text: '이번 주엔 아직 계획된 수업이 없어. 주간 계획에서 칸을 눌러 채워 볼까?', expression: 'thinking', links: [{ label: '주간 계획 열기', href: 'week' }] };
  const done = lessons.filter((l) => l.completed);
  const byClass = new Map<string, LessonRecord[]>();
  lessons.forEach((l) => byClass.set(l.classKey, [...(byClass.get(l.classKey) ?? []), l]));
  const lines = [...byClass.entries()]
    .sort()
    .map(([k, ls]) => `${k}: ${ls.map((l) => `${l.lesson.replace('Lesson ', 'L')}-${l.session}${l.completed ? '✓' : ''}`).join(', ')}`);
  const memos = lessons.filter((l) => l.memo?.trim()).slice(0, 3);
  const pending = lessons.filter((l) => !l.completed && l.date < today);
  let text = `이번 주 수업 ${lessons.length}개 중 ${done.length}개 끝냈어.\n${lines.join('\n')}`;
  if (memos.length) text += `\n\n메모 남긴 수업: ${memos.map((m) => `${m.classKey}(${m.memo!.slice(0, 18)}…)`).join(', ')}`;
  if (pending.length) text += `\n\n지난 수업 중 완료 표시 안 된 게 ${pending.length}개 있어.`;
  return {
    text,
    expression: pending.length ? 'surprised' : 'happy',
    links: pending.slice(0, 4).map((p) => ({ label: `${p.classKey} ${formatShort(p.date)} 열기`, lessonId: p.id })),
    action: pending.length
      ? {
          id: aid(),
          kind: 'write',
          label: '모두 완료로 표시',
          detail: pending.map((p) => `${p.classKey} · ${p.lesson} ${p.session}차시 (${formatShort(p.date)}) → 완료 + 진도표 반영`),
          run: async () => {
            for (const p of pending) await setLessonCompleted(p, true);
            return `${pending.length}개 수업을 완료로 표시하고 진도표에 반영했어.`;
          },
        }
      : undefined,
  };
}

export async function openTasks(): Promise<AssistantReply> {
  const today = todayISO();
  const tasks = (await db.tasks.toArray()).filter((t) => !t.completed);
  if (!tasks.length) return { text: '남은 할 일이 하나도 없어. 대단해!', expression: 'excited' };
  const overdue = tasks.filter((t) => taskBucket(t, today) === 'overdue');
  const todayT = tasks.filter((t) => taskBucket(t, today) === 'today');
  const week = tasks.filter((t) => taskBucket(t, today) === 'week');
  const fmt = (t: Task) => `• ${t.title}${t.dueDate ? ` (${relativeDue(t.dueDate)})` : ''}${t.important ? ' ★' : ''}`;
  const text = [
    `남은 일 ${tasks.length}개야.`,
    overdue.length ? `\n기한 지남 ${overdue.length}개\n${overdue.slice(0, 5).map(fmt).join('\n')}` : '',
    todayT.length ? `\n오늘 ${todayT.length}개\n${todayT.slice(0, 5).map(fmt).join('\n')}` : '',
    week.length ? `\n이번 주 ${week.length}개` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    text,
    expression: overdue.length ? 'worried' : 'confident',
    links: [{ label: 'Tasks 열기', href: 'tasks' }],
    action: overdue.length
      ? {
          id: aid(),
          kind: 'write',
          label: '오늘로 옮기기',
          detail: overdue.map((t) => `${t.title}: ${formatShort(t.dueDate!)} → 오늘`),
          run: async () => {
            for (const t of overdue) await repo.update<Task>('tasks', t.id, { dueDate: today });
            return `기한 지난 ${overdue.length}개를 오늘 할 일로 옮겼어.`;
          },
        }
      : undefined,
  };
}

export async function tidyMeeting(route: Route): Promise<AssistantReply> {
  const id = route.name === 'work' ? route.params[0] : undefined;
  const m = id ? await db.meetings.get(id) : (await db.meetings.orderBy('date').reverse().limit(1).toArray())[0];
  if (!m) return { text: '아직 회의 메모가 없어. 회의 들어가면 ‘부장회의’ 버튼으로 바로 만들어 봐.', expression: 'thinking', links: [{ label: '회의 · 업무 열기', href: 'work' }] };
  const sent = await db.tasks.where('sourceId').equals(m.id).toArray();
  const fromTodos = m.todos.split('\n');
  // 전달사항·결정사항·메모는 문장 단위로 나눠 기한이 있는 일만 고른다
  const fromOthers = [m.announcements, m.decisions, m.memo]
    .join('\n')
    .split(/\n|(?<=[.!?。])\s+/)
    .map((l) => l.replace(/[.。]$/, ''))
    .filter((l) => /(까지|제출|마감|보고|작성|신청)/.test(l));
  const candidates = [...fromTodos, ...fromOthers]
    .map((l) => l.trim())
    .filter((l) => l.length > 1)
    .map((l) => parseTaskText(l, m.date))
    .filter((p) => p.title && !sent.some((t) => t.title === p.title));
  const uniq = candidates.filter((c, i) => candidates.findIndex((x) => x.title === c.title) === i);
  const counts = [
    ['전달사항', m.announcements],
    ['결정사항', m.decisions],
    ['해야 할 일', m.todos],
  ]
    .map(([k, v]) => `${k} ${v.split('\n').filter((x) => x.trim()).length}줄`)
    .join(' · ');
  const label = `${formatShort(m.date)} ${m.title || m.kind}`;
  if (!uniq.length) {
    return { text: `‘${label}’ 정리해 봤어. ${counts}.\n새로 Tasks에 넣을 일은 안 보여${sent.length ? ` (이미 ${sent.length}개 보냄)` : ''}.`, expression: 'confident', links: [{ label: '회의록 열기', href: `work/${m.id}` }] };
  }
  return {
    text: `‘${label}’에서 할 일이 ${uniq.length}개 나왔어. Tasks에 넣어둘까?`,
    expression: 'excited',
    links: [{ label: '회의록 열기', href: `work/${m.id}` }],
    action: {
      id: aid(),
      kind: 'write',
      label: 'Tasks에 넣기',
      detail: uniq.map((u) => `□ ${u.title}${u.dueDate ? ` · 마감 ${formatShort(u.dueDate)}` : ''}`),
      run: async () => {
        for (const u of uniq) await addTask({ title: u.title, dueDate: u.dueDate, sourceType: 'meeting', sourceId: m.id, sourceLabel: label });
        return `${uniq.length}개를 Tasks에 넣었어. 출처는 ‘${label}’로 남겨 뒀어.`;
      },
    },
  };
}

export async function prepareNext(s: Settings): Promise<AssistantReply> {
  const today = todayISO();
  const plans: { cls: string; date: string; periodId: string; label: string; lesson: string; session: number; existing?: LessonRecord; apply: Partial<LessonRecord> }[] = [];
  const classes = allClasses(s);
  const ov = await loadOverrides(today, addDays(today, 14));
  for (const c of classes) {
    // 오늘부터 2주 안의 다음 시간표 칸
    let found = false;
    for (let d = 0; d < 14 && !found; d++) {
      const date = addDays(today, d);
      const wd = isoWeekday(date);
      if (!s.weekdays.includes(wd)) continue;
      for (const p of s.periods) {
        if (effectiveSlot(s, date, p.id, ov).classKey !== c.key) continue;
        const rec = await db.lessons.where('[date+periodId]').equals([date, p.id]).first();
        if (rec?.completed) continue;
        found = true;
        if (rec?.lesson) break; // 이미 계획됨
        const sug = await suggestNextFor(s, c.key, date, p.id);
        if (sug) plans.push({ cls: c.key, date, periodId: p.id, label: `${formatShort(date)} ${periodLabel(s, p.id)}`, lesson: sug.lesson, session: sug.session, existing: rec, apply: applySuggestion(sug) });
        break;
      }
    }
  }
  const upcoming = (await db.lessons.where('date').between(today, addDays(today, 1), true, true).toArray()).filter((l) => !l.completed);
  const materials = [...new Set(upcoming.flatMap((l) => l.materials.filter((m) => !m.done).map((m) => m.text)))];
  const matText = materials.length ? `\n\n오늘·내일 챙길 준비물: ${materials.join(', ')}` : '';
  if (!plans.length) {
    return {
      text: (Object.keys(s.timetable).length ? '다음 수업 칸은 이미 다 계획돼 있어. 준비 완료!' : '시간표가 비어 있어서 다음 수업을 못 찾았어. 설정 → 시간표를 먼저 채워 줘.') + matText,
      expression: Object.keys(s.timetable).length ? 'confident' : 'worried',
      links: Object.keys(s.timetable).length ? undefined : [{ label: '시간표 설정', href: 'settings?tab=timetable' }],
    };
  }
  return {
    text: `다음 수업 중 비어 있는 칸이 ${plans.length}개야. 진도에 맞춰 다음 차시를 넣어 둘까?${matText}`,
    expression: 'excited',
    action: {
      id: aid(),
      kind: 'write',
      label: '다음 차시 넣기',
      detail: plans.map((p) => `${p.cls} · ${p.label} → ${p.lesson} ${p.session}차시`),
      run: async () => {
        for (const p of plans) {
          if (p.existing) await repo.update<LessonRecord>('lessons', p.existing.id, p.apply);
          else await createLessonRecord(s, p.date, p.periodId, p.cls, p.apply);
        }
        return `${plans.length}개 수업 칸에 다음 차시를 넣었어. 주간 계획에서 확인해 봐.`;
      },
    },
    links: [{ label: '주간 계획 열기', href: 'week' }],
  };
}

export async function findLagging(s: Settings): Promise<AssistantReply> {
  const entries = await db.progress.toArray();
  // 완료했는데 진도표에 없는 수업 먼저 확인
  const keys = new Set(entries.map((e) => `${e.classKey}:${e.lessonId}:${e.session}`));
  const missing = (await db.lessons.filter((l) => l.completed && !!l.lessonId && l.session > 0).toArray()).filter((l) => inAcademicYear(s, l.date) && !keys.has(`${l.classKey}:${l.lessonId}:${l.session}`));
  if (missing.length) {
    const first = missing[0];
    return {
      text: `${first.classKey}가 ${first.lesson} ${first.session}차시까지 완료된 것으로 보여요${missing.length > 1 ? ` (외 ${missing.length - 1}개)` : ''}.\n진도표에 반영할까요?`,
      expression: 'surprised',
      action: {
        id: aid(),
        kind: 'write',
        label: '반영',
        detail: missing.map((m) => `${m.classKey} · ${m.lesson} ${m.session}차시 (${formatShort(m.date)})`),
        run: async () => {
          for (const m of missing) await setLessonCompleted({ ...m, completed: false }, true);
          return '진도표에 반영했어. 다시 ‘진도 늦은 반 찾기’를 눌러 비교해 봐.';
        },
      },
    };
  }
  const lines: string[] = [];
  const behind: string[] = [];
  for (const g of s.grades) {
    const prog = allClasses(s)
      .filter((c) => c.grade === g)
      .map((c) => computeClassProgress(s, c, entries));
    if (!prog.length) continue;
    const lead = Math.max(...prog.map((p) => p.done));
    lines.push(`${g}학년: ${prog.map((p) => `${p.key} ${p.done}`).join(' · ')} (/${s.totalSessions})`);
    prog.filter((p) => lead - p.done >= 1).forEach((p) => behind.push(`${p.key}이(가) ${lead - p.done}차시 느려 보여`));
  }
  if (!lines.length) return { text: '아직 진도 기록이 없어. 수업 카드에서 ‘완료’를 누르면 쌓여.', expression: 'neutral' };
  if (!behind.length) return { text: `반별 진도가 나란해!\n${lines.join('\n')}`, expression: 'happy', links: [{ label: '진도표 열기', href: 'progress' }] };
  const today = todayISO();
  const nextMon = dateOfWeekday(addDays(startOfWeek(today), 7), 1);
  return {
    text: `${behind.join('.\n')}.\n\n${lines.join('\n')}\n\n다음 주 계획에 반영할까?`,
    expression: 'worried',
    links: [{ label: '진도표 열기', href: 'progress' }],
    action: {
      id: aid(),
      kind: 'write',
      label: '할 일로 남기기',
      detail: behind.map((b) => `□ ${b.split('이(가)')[0]} 진도 보충 계획 · 마감 ${formatShort(nextMon)}`),
      run: async () => {
        for (const b of behind) await addTask({ title: `${b.split('이(가)')[0]} 진도 보충 계획`, dueDate: nextMon, sourceType: 'assistant', sourceLabel: 'AI 비서 · 진도 비교' });
        return `다음 주 월요일(${WEEKDAY_KO[1]}) 할 일로 남겨 뒀어.`;
      },
    },
  };
}

/** 근거 검색 결과를 비서 답변 형태로 바꾼다 */
export function fromGrounded(g: GroundedReply): AssistantReply {
  const notFound = g.text.trim() === NOT_FOUND;
  return {
    text: g.text,
    expression: notFound ? 'worried' : g.debug.mode === 'summary' ? 'confident' : 'happy',
    footer: notFound ? `검색 조건: ${g.debug.conditions}` : g.footer,
    debug: g.debug,
    links: g.sources.slice(0, 6).map((u) => (u.lessonRecordId ? { label: `${u.date ?? ''} ${u.title}`, lessonId: u.lessonRecordId } : { label: `${u.date ?? ''} ${u.title}`, href: u.href })),
  };
}

/** "지난 메모 찾기": AI 없이 기기 안 기록만 검색해서 보여준다 */
export async function findMemos(q: string, s: Settings): Promise<AssistantReply> {
  return fromGrounded(await askWithRecords(s, null, q, []));
}

/** 외부 AI가 없을 때: 검색한 기록을 그대로 보여준다(지어내는 문장 없음) */
export async function localAnswer(q: string, s: Settings, _route: Route): Promise<AssistantReply> {
  void _route;
  return fromGrounded(await askWithRecords(s, null, q, []));
}
