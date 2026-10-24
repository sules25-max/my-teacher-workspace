import { db } from '../localDb';
import type { Settings } from '../../types';
import { effectiveSlot, periodLabel, type OverrideMap } from '../planner';
import { INK_ONLY, TEMPLATES } from '../pages';
import type { DocKind } from './query';
import { weekdayKo } from './query';
import { isoWeekday } from '../../utils/date';

// 업무수첩의 모든 사용자 기록을 "검색 문서"로 펼친다(읽기 전용, 저장 구조는 건드리지 않음).

export interface RecordDoc {
  key: string; // `${kind}:${id}`
  kind: DocKind;
  id: string;
  date?: string; // 기록이 가리키는 날짜(수업일 · 회의일 · 마감일 등)
  dates?: string[]; // 날짜 검색에 함께 쓰는 날짜들(할 일: 마감 · 등록 · 완료일 / 페이지: 작성 · 수정일)
  grade?: number;
  classKey?: string;
  title: string; // 한 줄 제목
  text: string; // AI에게 줄 본문(사람이 읽을 수 있는 형태)
  done?: boolean; // 할 일 · 수업 완료 여부
  irregular?: boolean; // 정규 시간표와 다른 수업
  createdAt?: string;
  updatedAt?: string;
  href?: string;
  lessonRecordId?: string;
}

const line = (label: string, v?: string | number | null) => (v === undefined || v === null || v === '' ? '' : `${label}: ${v}`);
const join = (...xs: string[]) => xs.filter(Boolean).join(' · ');
const dayLabel = (d?: string) => (d ? `${d}(${weekdayKo(d)})` : '');

export async function buildCorpus(s: Settings): Promise<RecordDoc[]> {
  const [lessons, overrides, meetings, tasks, events, notes, pages, groups, progress, inkDocs] = await Promise.all([
    db.lessons.toArray(),
    db.slotOverrides.toArray(),
    db.meetings.toArray(),
    db.tasks.toArray(),
    db.events.toArray(),
    db.notes.toArray(),
    db.pages.toArray(),
    db.pageGroups.toArray(),
    db.progress.toArray(),
    db.inkDocs.toArray(),
  ]);
  const ov: OverrideMap = new Map(overrides.map((o) => [`${o.date}:${o.periodId}`, o]));
  const docs: RecordDoc[] = [];

  // 수업 기록 (정규 시간표와 다른 수업 표시)
  for (const l of lessons) {
    const eff = effectiveSlot(s, l.date, l.periodId, ov);
    const regular = eff.regular;
    const o = eff.override;
    const irregular = !!o || (!!regular && regular !== l.classKey) || !regular;
    const why = o?.kind === 'substitute' || /보결/.test(o?.note ?? '')
      ? `보결 수업(원래 ${regular ?? '수업 없음'})`
      : o?.kind === 'move'
        ? `옮긴 수업(원래 ${regular ?? '수업 없음'})`
        : irregular
          ? `정규 시간표와 다름(원래 ${regular ?? '수업 없음'} → ${l.classKey})`
          : '';
    docs.push({
      key: `lesson:${l.id}`,
      kind: 'lesson',
      id: l.id,
      date: l.date,
      grade: l.grade,
      classKey: l.classKey,
      title: `${l.classKey} ${l.lesson || '수업'}${l.session ? ` ${l.session}차시` : ''}`,
      text: join(
        `${dayLabel(l.date)} ${periodLabel(s, l.periodId)} ${l.grade}학년 ${l.classNumber}반(${l.classKey}) 수업`,
        l.lesson ? `${l.lesson}${l.session ? ` ${l.session}/${l.totalSessions ?? '?'}차시` : ''}` : '',
        line('목표', l.objective),
        line('활동', l.activities.map((a) => `${a.done ? '✓' : '□'}${a.text}`).join(', ')),
        line('준비물', l.materials.map((a) => `${a.done ? '✓' : '□'}${a.text}`).join(', ')),
        line('수업 메모', l.memo),
        l.completed ? '수업 완료' : '완료 표시 안 됨',
        why,
        o?.note ? `변경 사유: ${o.note}` : '',
      ),
      done: l.completed,
      irregular,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      lessonRecordId: l.id,
    });
  }

  // 이번 주만 바꾼 시간표 (반 변경 · 휴강 · 보결 · 이동)
  for (const o of overrides) {
    const regular = s.timetable[`${isoWeekday(o.date)}:${o.periodId}`];
    const what = o.classKey === null ? `휴강(원래 ${regular ?? '수업 없음'})` : o.kind === 'substitute' ? `${o.classKey} 보결 수업` : `${regular ?? '빈 칸'} → ${o.classKey}`;
    docs.push({
      key: `change:${o.id}`,
      kind: 'change',
      id: o.id,
      date: o.date,
      classKey: o.classKey ?? regular,
      grade: Number((o.classKey ?? regular ?? '').split('-')[0]) || undefined,
      title: `${periodLabel(s, o.periodId)} ${what}`,
      text: join(`${dayLabel(o.date)} ${periodLabel(s, o.periodId)} 시간표 변경`, what, line('사유', o.note)),
      irregular: true,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    });
  }

  for (const m of meetings) {
    docs.push({
      key: `meeting:${m.id}`,
      kind: 'meeting',
      id: m.id,
      date: m.date,
      title: m.title || m.kind,
      dates: [m.date, m.updatedAt.slice(0, 10)],
      text: [
        `${dayLabel(m.date)} ${m.kind} "${m.title}"${m.archived ? ' (보관됨)' : ''}`,
        line('전달사항', m.announcements),
        line('결정사항', m.decisions),
        line('해야 할 일', m.todos),
        line('메모', m.memo),
      ]
        .filter(Boolean)
        .join('\n'),
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      href: `work/${m.id}`,
    });
  }

  for (const t of tasks) {
    docs.push({
      key: `task:${t.id}`,
      kind: 'task',
      id: t.id,
      date: t.dueDate ?? t.createdAt.slice(0, 10),
      title: t.title,
      text: join(
        `할 일 "${t.title}"`,
        t.completed ? `완료${t.completedAt ? `(${t.completedAt.slice(0, 10)})` : ''}` : '미완료',
        t.dueDate ? `마감 ${dayLabel(t.dueDate)}` : '마감 없음',
        t.important ? '중요' : '',
        t.sourceLabel ? `출처: ${t.sourceLabel}` : '',
        `등록 ${t.createdAt.slice(0, 10)}`,
      ),
      done: t.completed,
      dates: [t.dueDate, t.createdAt.slice(0, 10), t.completedAt?.slice(0, 10)].filter(Boolean) as string[],
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      href: 'tasks',
    });
  }

  const catLabel = (id: string) => s.categories.find((c) => c.id === id)?.label ?? id;
  for (const e of events) {
    docs.push({
      key: `event:${e.id}`,
      kind: 'event',
      id: e.id,
      date: e.date,
      title: e.title,
      text: join(`${dayLabel(e.date)}${e.endDate && e.endDate !== e.date ? ` ~ ${e.endDate}` : ''}${e.time ? ` ${e.time}` : ''} 일정`, `[${catLabel(e.category)}] ${e.title}`, line('메모', e.memo)),
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      href: `month?d=${e.date}`,
    });
  }

  for (const n of notes) {
    if (!n.text.trim()) continue;
    const kind: DocKind = n.kind === 'day' ? 'dayNote' : n.kind === 'summary' ? 'summary' : n.kind === 'inbox' ? 'inbox' : 'note';
    const label = { note: '빠른 메모', dayNote: '날짜 메모', summary: '하루 정리', inbox: 'AI Inbox' }[kind as 'note'];
    docs.push({
      key: `${kind}:${n.id}`,
      kind,
      id: n.id,
      date: n.date,
      title: n.title || `${label} ${n.date}`,
      text: `${dayLabel(n.date)} ${label}${n.title ? ` "${n.title}"` : ''}\n${n.text}`,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      href: n.kind === 'day' ? `month?d=${n.date}` : 'archive?tab=notes',
    });
  }

  const groupName = (id?: string) => groups.find((g) => g.id === id)?.name;
  const inkById = new Map(inkDocs.map((d) => [d.id, d]));
  for (const p of pages) {
    const tmpl = TEMPLATES.find((t) => t.id === p.template)?.label ?? p.template;
    const body = p.blocks
      .map((b) => {
        if (b.type === 'text' || b.type === 'heading') return b.text.trim() ? `${'label' in b && b.label ? `${b.label}: ` : ''}${b.text}` : '';
        if (b.type === 'checklist') return b.items.length ? `${b.label ? `${b.label}: ` : ''}${b.items.map((i) => `${i.done ? '✓' : '□'}${i.text}`).join(', ')}` : '';
        const ink = inkById.get(b.docId);
        return ink && (ink.strokes.length || ink.images.length) ? `(손글씨 ${ink.strokes.length}획${ink.images.length ? ` · 사진 ${ink.images.length}장` : ''} — 손글씨 글자는 읽을 수 없음)` : '';
      })
      .filter(Boolean)
      .join('\n');
    const isBoard = p.template === 'board' || INK_ONLY.includes(p.template);
    docs.push({
      key: `${isBoard ? 'board' : 'page'}:${p.id}`,
      kind: isBoard ? 'board' : 'page',
      id: p.id,
      date: p.updatedAt.slice(0, 10),
      title: p.title,
      text: `${isBoard ? '자유보드' : `페이지(${tmpl})`} "${p.title}"${groupName(p.groupId) ? ` · 그룹 ${groupName(p.groupId)}` : ''}${p.archived ? ' (보관됨)' : ''} · 마지막 수정 ${p.updatedAt.slice(0, 10)}\n${body || '(글자 내용 없음)'}`,
      dates: [p.createdAt.slice(0, 10), p.updatedAt.slice(0, 10)],
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      href: isBoard ? `board/${p.id}` : `pages/${p.id}`,
    });
  }

  for (const e of progress) {
    docs.push({
      key: `progress:${e.id}`,
      kind: 'progress',
      id: e.id,
      date: e.date,
      grade: e.grade,
      classKey: e.classKey,
      title: `${e.classKey} ${e.lesson} ${e.session}차시 완료`,
      text: `${dayLabel(e.date)} 진도: ${e.classKey} ${e.lesson} ${e.session}차시 완료 (${e.source === 'lesson' ? '수업 카드에서 완료' : e.source === 'assistant' ? 'AI 비서로 반영' : '진도표에서 직접 표시'})`,
      done: true,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      href: 'progress',
    });
  }

  return docs;
}
