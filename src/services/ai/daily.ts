import type { Settings, Task } from '../../types';
import { db } from '../localDb';
import { buildCorpus, type RecordDoc } from './corpus';
import { effectiveSlot, loadOverrides, periodLabel } from '../planner';
import { addDays, toISODate } from '../../utils/date';
import { summarizeDocs } from './summarize';
import type { AIProvider } from './provider';
import { KIND_LABEL } from './query';
import { parseTaskText } from '../tasks';

// "✨ 오늘 하루 정리": 오늘과 관련된 실제 업무수첩 기록을 모두 모아 하루를 정리한다.
// 읽기만 한다. 저장은 사용자가 [오늘 기록으로 저장]을 눌렀을 때만(DailySummary.tsx).

export const DAILY_SECTIONS = ['오늘 한 일', '오늘 수업', '완료한 업무', '아직 남은 업무', '오늘 기록한 중요 메모', '다음 수업에 반영할 내용', '내일 또는 이후에 해야 할 일'];

export interface DailyGroup {
  id: string;
  label: string;
  docs: RecordDoc[];
}

export interface DailyCollection {
  date: string;
  groups: DailyGroup[]; // 화면에 보여줄 수집 범위(빈 그룹 제외)
  docs: RecordDoc[]; // 중복 없이 AI에게 줄 전체 기록
  openTasks: Task[]; // 지금 Todo에 있는 미완료 할 일(중복 확인용)
  meetingTodos: { text: string; from: string }[]; // 오늘 회의의 "해야 할 일" 줄(원본 그대로)
}

/** ISO 시각(UTC 저장)을 이 기기 시간 기준 날짜로 */
const localDay = (iso?: string) => (iso ? toISODate(new Date(iso)) : '');

export async function collectToday(s: Settings, date: string): Promise<DailyCollection> {
  const corpus = await buildCorpus(s);
  const byKey = new Map(corpus.map((d) => [d.key, d]));
  const touchedToday = (d: RecordDoc) => localDay(d.createdAt) === date || localDay(d.updatedAt) === date;
  const tasks = await db.tasks.toArray();
  const taskDoc = (t: Task) => byKey.get(`task:${t.id}`)!;
  const soon = addDays(date, 7);

  // 시간표상 오늘 수업인데 아직 기록이 없는 칸도 "오늘 수업 계획"으로 포함
  const ov = await loadOverrides(date, date);
  const todayLessons = corpus.filter((d) => d.kind === 'lesson' && d.date === date);
  const todayRecs = await db.lessons.where('date').equals(date).toArray();
  const planned: RecordDoc[] = [];
  for (const p of s.periods) {
    const eff = effectiveSlot(s, date, p.id, ov);
    if (!eff.classKey) continue;
    if (todayRecs.some((r) => r.periodId === p.id)) continue; // 이미 수업 기록이 있는 칸
    planned.push({
      key: `slot:${date}:${p.id}`,
      kind: 'lesson',
      id: `${date}:${p.id}`,
      date,
      classKey: eff.classKey,
      grade: Number(eff.classKey.split('-')[0]),
      title: `${eff.classKey} 수업(시간표)`,
      text: `${date} ${periodLabel(s, p.id)} ${eff.classKey} 수업 — 시간표에만 있고 수업 기록은 아직 없음${eff.override ? ` (이번 주 변경: ${eff.override.note ?? '반 변경'})` : ''}`,
    });
  }

  const groups: DailyGroup[] = [
    { id: 'lessons', label: '오늘 수업', docs: [...todayLessons, ...planned] },
    { id: 'done', label: '완료한 할 일', docs: tasks.filter((t) => t.completed && localDay(t.completedAt) === date).map(taskDoc) },
    { id: 'open', label: '아직 남은 할 일(마감 오늘 이전)', docs: tasks.filter((t) => !t.completed && t.dueDate && t.dueDate <= date).map(taskDoc) },
    { id: 'new', label: '오늘 새로 등록한 할 일', docs: tasks.filter((t) => localDay(t.createdAt) === date).map(taskDoc) },
    { id: 'upcoming', label: '이후 할 일 · 일정(7일 안)', docs: [...tasks.filter((t) => !t.completed && t.dueDate && t.dueDate > date && t.dueDate <= soon).map(taskDoc), ...corpus.filter((d) => d.kind === 'event' && d.date! > date && d.date! <= soon)] },
    { id: 'events', label: '오늘 일정', docs: corpus.filter((d) => d.kind === 'event' && d.date === date) },
    { id: 'meetings', label: '회의 기록', docs: corpus.filter((d) => d.kind === 'meeting' && (d.date === date || touchedToday(d))) },
    { id: 'notes', label: '메모 · AI Inbox', docs: corpus.filter((d) => (d.kind === 'note' || d.kind === 'dayNote' || d.kind === 'inbox') && (d.date === date || touchedToday(d))) },
    { id: 'pages', label: '오늘 쓴 페이지 · 자유보드', docs: corpus.filter((d) => (d.kind === 'page' || d.kind === 'board') && touchedToday(d)) },
    { id: 'progress', label: '진도 변경', docs: corpus.filter((d) => d.kind === 'progress' && (d.date === date || touchedToday(d))) },
    { id: 'changes', label: '시간표 변경', docs: corpus.filter((d) => d.kind === 'change' && d.date === date) },
    { id: 'edited', label: '오늘 수정한 다른 날 수업 계획', docs: corpus.filter((d) => d.kind === 'lesson' && d.date !== date && touchedToday(d)) },
  ].filter((g) => g.docs.length);

  const seen = new Set<string>();
  const docs: RecordDoc[] = [];
  for (const g of groups) for (const d of g.docs) if (!seen.has(d.key)) (seen.add(d.key), docs.push(d));
  const meetingIds = new Set(groups.find((g) => g.id === 'meetings')?.docs.map((d) => d.id) ?? []);
  const meetingTodos = (await db.meetings.bulkGet([...meetingIds]))
    .filter(Boolean)
    .flatMap((m) =>
      m!.todos
        .split('\n')
        .map((l) => parseTaskText(l).title)
        .filter((x) => x.length > 1)
        .map((text) => ({ text, from: m!.title || m!.kind })),
    );
  return { date, groups, docs, openTasks: tasks.filter((t) => !t.completed), meetingTodos };
}

/** AI 없이 기록만으로 만드는 정리(오류 · 오프라인일 때). 기록에 있는 문장만 쓴다. */
export function localDailySummary(c: DailyCollection): string {
  const g = (id: string) => c.groups.find((x) => x.id === id)?.docs ?? [];
  const short = (d: RecordDoc) => d.text.replace(/\s+/g, ' ').slice(0, 120);
  const sec: [string, string[]][] = [
    ['오늘 한 일', [...g('lessons').filter((d) => d.done).map((d) => `${d.title} 수업 완료`), ...g('done').map((d) => `${d.title} 완료`), ...g('meetings').map((d) => `${d.title} 참석/기록`)]],
    ['오늘 수업', g('lessons').map(short)],
    ['완료한 업무', g('done').map((d) => d.title)],
    ['아직 남은 업무', g('open').map((d) => d.title)],
    ['오늘 기록한 중요 메모', [...g('notes').map(short), ...g('lessons').filter((d) => /수업 메모:/.test(d.text)).map((d) => `${d.classKey}: ${d.text.split('수업 메모: ')[1]?.split(' · ')[0] ?? ''}`)]],
    ['다음 수업에 반영할 내용', g('lessons').filter((d) => /수업 메모:/.test(d.text)).map((d) => `${d.classKey}: ${d.text.split('수업 메모: ')[1]?.split(' · ')[0] ?? ''}`)],
    ['내일 또는 이후에 해야 할 일', g('upcoming').map((d) => `${d.title} (${d.date})`)],
  ];
  return sec
    .filter(([, items]) => items.filter(Boolean).length)
    .map(([h, items]) => `## ${h}\n${[...new Set(items.filter(Boolean))].map((x) => `- ${x}`).join('\n')}`)
    .join('\n\n');
}

export async function aiDailySummary(provider: AIProvider, c: DailyCollection, onProgress?: (m: string) => void) {
  return summarizeDocs(provider, c.docs, {
    scopeLabel: `${c.date} 하루`,
    sections: DAILY_SECTIONS,
    extraRules:
      '이건 교사의 오늘 하루 업무 정리야. "아직 남은 업무"에는 기록에 미완료로 적힌 일만 넣고, "다음 수업에 반영할 내용"은 수업 메모에서만 뽑아. "시간표에만 있고 수업 기록은 아직 없음"인 수업은 했다고 단정하지 마.',
    onProgress: (p) => onProgress?.(p.stage === 'map' ? `오늘 기록 ${c.docs.length}개를 읽는 중… (${p.done + 1}/${p.total})` : '정리한 내용을 합치는 중…'),
  });
}

// ---------- 남은 업무 후보 · Todo 중복 확인 ----------

const norm = (s: string) => s.toLowerCase().replace(/[\s\-·•□☐✓,.!?()[\]"'“”]/g, '');
function bigrams(s: string) {
  const n = norm(s);
  const out = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  return out;
}
/** 같은 할 일인지: 거의 같은 문장일 때만 true (앞부분만 같은 "준비물: 활동지" / "준비물: 시계 카드"는 다름) */
export function similar(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length >= 4 && long.includes(short) && long.length <= short.length * 1.6) return true;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  A.forEach((x) => B.has(x) && inter++);
  return inter / Math.max(1, A.size + B.size - inter) >= 0.75;
}

export interface TodoCandidate {
  text: string;
  from: string; // 어디서 나왔는지
  existing?: Task; // 이미 Todo에 있으면 그 항목
}

/** 남은 업무 후보: 오늘 기록 속 "해야 할 일" 줄 + AI 정리의 "아직 남은 업무" 항목. 이미 Todo에 있는지 표시한다. */
export function todoCandidates(c: DailyCollection, summaryText: string, allTasks: Task[]): TodoCandidate[] {
  const raw: TodoCandidate[] = c.meetingTodos.map((m) => ({ ...m }));
  for (const d of c.docs) {
    if (d.kind === 'lesson' && /준비물:/.test(d.text)) {
      const mats = d.text.split('준비물: ')[1]?.split(' · ')[0] ?? '';
      mats
        .split(', ')
        .filter((m) => m.startsWith('□'))
        .forEach((m) => raw.push({ text: `${d.classKey} 준비물 챙기기: ${m.slice(1)}`, from: d.title }));
    }
  }
  // AI 정리 중 "아직 남은 업무" 항목
  const sec = summaryText.split(/\n(?=##\s)/).find((b) => /^##\s*아직 남은 업무/.test(b.trim()));
  sec
    ?.split('\n')
    .slice(1)
    .map((l) => l.replace(/^[-•□\s]+/, '').replace(/\s*\(\d{1,2}\/\d{1,2}\)\s*$/, '').trim())
    .filter((x) => x.length > 1)
    .forEach((t) => raw.push({ text: t, from: 'AI 정리' }));

  const out: TodoCandidate[] = [];
  for (const r of raw) {
    if (out.some((o) => similar(o.text, r.text))) continue;
    const existing = allTasks.find((t) => similar(t.title, r.text));
    out.push({ ...r, existing });
  }
  return out;
}

export function countLabel(total: number, analyzed: number) {
  return analyzed === total ? `오늘 총 ${total}개 기록을 확인했습니다.` : `오늘 기록 ${total}개 중 ${analyzed}개를 확인했습니다. (나머지는 요청 실패)`;
}

export { KIND_LABEL };
