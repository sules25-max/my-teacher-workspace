import { db } from './localDb';
import { pagePlainText } from './pages';
import { snippet } from '../utils/id';
import { formatShort } from '../utils/date';

export type SearchKind = 'lesson' | 'meeting' | 'page' | 'task' | 'event' | 'note';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string;
  date?: string;
  href?: string; // 해시 경로
  score: number;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  lesson: '수업메모',
  meeting: '회의메모',
  page: '페이지',
  task: '할 일',
  event: '일정',
  note: '메모',
};

function score(hay: string, terms: string[]): number {
  const h = hay.toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (!h.includes(t)) return 0;
    s += 1 + (h.split(t).length - 1) * 0.2;
  }
  return s;
}

/** 기기 안의 IndexedDB만 검색한다(외부 전송 없음). 공백으로 나눈 모든 단어를 포함해야 한다. */
export async function searchAll(query: string, limit = 40): Promise<SearchResult[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out: SearchResult[] = [];
  const first = terms[0];

  await db.lessons.each((l) => {
    const hay = `${l.classKey} ${l.grade}학년 ${l.classNumber}반 ${l.lesson} ${l.objective ?? ''} ${l.memo ?? ''} ${l.activities.map((a) => a.text).join(' ')}`;
    const sc = score(hay, terms);
    if (sc) out.push({ kind: 'lesson', id: l.id, title: `${l.classKey} ${l.lesson || '수업'} ${l.session ? l.session + '차시' : ''}`, snippet: snippet(l.memo || l.objective || '', first), date: l.date, score: sc });
  });
  await db.meetings.each((m) => {
    const body = [m.announcements, m.decisions, m.todos, m.memo].join('\n');
    const sc = score(`${m.title} ${m.kind} ${body}`, terms);
    if (sc) out.push({ kind: 'meeting', id: m.id, title: m.title || m.kind, snippet: snippet(body, first), date: m.date, href: `work/${m.id}`, score: sc });
  });
  await db.pages.each((p) => {
    const body = pagePlainText(p);
    const sc = score(`${p.title} ${body}`, terms);
    if (sc) out.push({ kind: 'page', id: p.id, title: p.title, snippet: snippet(body, first), date: p.updatedAt.slice(0, 10), href: p.template === 'board' ? `board/${p.id}` : `pages/${p.id}`, score: sc + 0.5 });
  });
  await db.tasks.each((t) => {
    const sc = score(`${t.title} ${t.sourceLabel ?? ''}`, terms);
    if (sc) out.push({ kind: 'task', id: t.id, title: `${t.completed ? '☑' : '☐'} ${t.title}`, snippet: t.dueDate ? `마감 ${formatShort(t.dueDate)}` : '', date: t.dueDate, href: 'tasks', score: sc });
  });
  await db.events.each((e) => {
    const sc = score(`${e.title} ${e.memo ?? ''}`, terms);
    if (sc) out.push({ kind: 'event', id: e.id, title: e.title, snippet: snippet(e.memo ?? '', first), date: e.date, href: `month?d=${e.date}`, score: sc });
  });
  await db.notes.each((n) => {
    const sc = score(n.text, terms);
    if (sc) out.push({ kind: 'note', id: n.id, title: n.kind === 'day' ? `${formatShort(n.date)} 메모` : '빠른 메모', snippet: snippet(n.text, first), date: n.date, href: n.kind === 'day' ? `month?d=${n.date}` : 'archive?tab=notes', score: sc });
  });

  return out.sort((a, b) => b.score - a.score || ((a.date ?? '') < (b.date ?? '') ? 1 : -1)).slice(0, limit);
}
