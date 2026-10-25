import { db } from '../localDb';
import type { Route } from '../../hooks/useRoute';
import type { AIContext } from './provider';
import { addDays, startOfWeek, todayISO } from '../../utils/date';
import { pagePlainText } from '../pages';

const clip = (s: string, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);

/**
 * 외부 AI에 보낼 context는 현재 화면과 직접 관련된 데이터만 담는다.
 * 사진·첨부 파일·손글씨는 보내지 않는다.
 */
export async function buildContext(route: Route): Promise<AIContext | null> {
  const today = todayISO();
  switch (route.name) {
    case 'today': {
      const lessons = await db.lessons.where('date').equals(today).toArray();
      const tasks = (await db.tasks.toArray()).filter((t) => !t.completed && t.dueDate && t.dueDate <= today);
      return {
        label: `오늘 수업 ${lessons.length}개 · 오늘 할 일 ${tasks.length}개`,
        text: [
          `오늘: ${today}`,
          ...lessons.map((l) => `- ${l.classKey} ${l.lesson} ${l.session}차시 ${l.completed ? '(완료)' : ''} 메모: ${clip(l.memo ?? '', 120)}`),
          '할 일:',
          ...tasks.map((t) => `- ${t.title} (마감 ${t.dueDate})`),
        ].join('\n'),
      };
    }
    case 'week': {
      const ws = startOfWeek(route.query.get('d') ?? today);
      const lessons = await db.lessons.where('date').between(ws, addDays(ws, 6), true, true).toArray();
      return {
        label: `이번 주 수업 ${lessons.length}개`,
        text: lessons
          .sort((a, b) => (a.date + a.period < b.date + b.period ? -1 : 1))
          .map((l) => `- ${l.date} ${l.classKey} ${l.lesson} ${l.session}차시 ${l.completed ? '(완료)' : ''} 목표: ${l.objective ?? ''} 메모: ${clip(l.memo ?? '', 120)}`)
          .join('\n'),
      };
    }
    case 'work': {
      const id = route.params[0];
      const m = id ? await db.meetings.get(id) : (await db.meetings.orderBy('date').reverse().limit(1).toArray())[0];
      if (!m) return null;
      return {
        label: `회의록 1개 (${m.title})`,
        text: clip(`[${m.kind}] ${m.title} ${m.date}\n전달사항: ${m.announcements}\n결정사항: ${m.decisions}\n해야 할 일: ${m.todos}\n메모: ${m.memo}`, 2500),
      };
    }
    case 'pages':
    case 'board': {
      const id = route.params[0];
      const p = id ? await db.pages.get(id) : undefined;
      if (!p) return null;
      const typed: string[] = [];
      for (const b of p.blocks) if (b.type === 'ink') (await db.inkDocs.get(b.docId))?.texts?.forEach((t) => t.text.trim() && typed.push(t.text.trim()));
      return { label: `자유보드 1개 (${p.title})`, text: clip(`${p.title}\n${[pagePlainText(p), ...typed].filter(Boolean).join('\n')}`, 2500) };
    }
    case 'tasks': {
      const tasks = (await db.tasks.toArray()).filter((t) => !t.completed);
      return { label: `남은 할 일 ${tasks.length}개`, text: tasks.map((t) => `- ${t.title}${t.dueDate ? ` (마감 ${t.dueDate})` : ''}`).join('\n') };
    }
    case 'progress': {
      const entries = await db.progress.toArray();
      const by = new Map<string, number>();
      entries.forEach((e) => by.set(e.classKey, (by.get(e.classKey) ?? 0) + 1));
      return { label: `반별 진도 ${by.size}개 반`, text: [...by.entries()].map(([k, n]) => `${k}: ${n}차시 완료`).join('\n') };
    }
    default:
      return null;
  }
}
