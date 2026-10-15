import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { db } from '../services/localDb';
import * as repo from '../services/repo';
import { useRoute, navigate } from '../hooks/useRoute';
import type { MeetingNote, Note, WorkspacePage } from '../types';
import { formatShort, parseISODate } from '../utils/date';
import { cx } from '../utils/id';
import { EmptyState } from '../components/common/EmptyState';
import { confirmDialog, toast } from '../components/common/overlays';
import { openLesson } from '../components/planner/lessonDrawerStore';
import { deletePage } from '../services/pages';

type Tab = 'lessons' | 'meetings' | 'pages' | 'notes';
const TABS: [Tab, string][] = [
  ['lessons', '수업 기록'],
  ['meetings', '회의록'],
  ['pages', '페이지'],
  ['notes', '메모'],
];

/** 3월~다음 해 2월을 한 학년도로 본다. 1학기: 3/1~8/15, 2학기: 8/16~2월 말 */
function academicOf(date: string): { year: number; semester: 1 | 2 } {
  const d = parseISODate(date);
  const m = d.getMonth() + 1;
  const year = m >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const semester = m >= 3 && (m < 8 || (m === 8 && d.getDate() <= 15)) ? 1 : 2;
  return { year, semester };
}

export function ArchivePage() {
  const route = useRoute();
  const tab = (route.query.get('tab') as Tab) || 'lessons';
  const [year, setYear] = useState<number | 'all'>('all');
  const [semester, setSemester] = useState<0 | 1 | 2>(0);

  const lessons = useLiveQuery(() => db.lessons.orderBy('date').reverse().toArray(), []) ?? [];
  const meetings = useLiveQuery(() => db.meetings.orderBy('date').reverse().toArray(), []) ?? [];
  const pages = useLiveQuery(() => db.pages.filter((p) => !!p.archived).toArray(), []) ?? [];
  const notes = useLiveQuery(() => db.notes.orderBy('date').reverse().filter((n) => n.kind === 'quick').toArray(), []) ?? [];

  const years = useMemo(() => {
    const ys = new Set<number>();
    [...lessons.map((l) => l.date), ...meetings.map((m) => m.date), ...notes.map((n) => n.date)].forEach((d) => ys.add(academicOf(d).year));
    return [...ys].sort((a, b) => b - a);
  }, [lessons, meetings, notes]);

  const match = (date: string) => {
    const a = academicOf(date);
    return (year === 'all' || a.year === year) && (!semester || a.semester === semester);
  };

  return (
    <div className="archive">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Archive</h1>
          <p className="page-head__sub">지우지 않고 모아 둔 지난 기록</p>
        </div>
        <div className="page-head__actions">
          <select className="select" value={year} onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="학년도">
            <option value="all">모든 학년도</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}학년도
              </option>
            ))}
          </select>
          <div className="seg" aria-label="학기">
            {([0, 1, 2] as const).map((s) => (
              <button key={s} aria-pressed={semester === s} onClick={() => setSemester(s)}>
                {s === 0 ? '전체' : `${s}학기`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="seg archive__tabs" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => navigate(`archive?tab=${t}`)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'lessons' && <LessonArchive items={lessons.filter((l) => match(l.date) && (l.lesson || l.memo))} />}
      {tab === 'meetings' && <MeetingArchive items={meetings.filter((m) => match(m.date))} />}
      {tab === 'pages' && <PageArchive items={pages.filter((p) => match(p.updatedAt.slice(0, 10)))} />}
      {tab === 'notes' && <NoteArchive items={notes.filter((n) => match(n.date))} />}
    </div>
  );
}

function groupByMonth<T>(items: T[], date: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = date(it).slice(0, 7);
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return [...m.entries()];
}

function LessonArchive({ items }: { items: import('../types').LessonRecord[] }) {
  if (!items.length) return <EmptyState text="조건에 맞는 수업 기록이 없어." />;
  return (
    <div className="archive__months">
      {groupByMonth(items, (l) => l.date).map(([month, list]) => (
        <section key={month} className="card archive-month">
          <div className="card__head">
            <h2 className="card__title">
              {month.slice(0, 4)}. {Number(month.slice(5))}월
            </h2>
            <span className="chip">
              완료 {list.filter((l) => l.completed).length} / {list.length}
            </span>
          </div>
          <ul className="list-reset card__body archive-list">
            {list.map((l) => (
              <li key={l.id}>
                <button className="archive-row" onClick={() => openLesson({ recordId: l.id })}>
                  <span className="archive-row__date">{formatShort(l.date)}</span>
                  <span className="title-font">{l.classKey}</span>
                  <span>
                    {l.lesson} {l.session ? `${l.session}차시` : ''}
                  </span>
                  <span className="archive-row__memo muted">{l.memo}</span>
                  <span className={cx('chip', l.completed && 'chip--done')}>{l.completed ? '완료' : '계획'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MeetingArchive({ items }: { items: MeetingNote[] }) {
  if (!items.length) return <EmptyState text="회의록이 없어." />;
  return (
    <ul className="list-reset card archive-list archive-list--card">
      {items.map((m) => (
        <li key={m.id} className="archive-row archive-row--static">
          <span className="archive-row__date">{formatShort(m.date)}</span>
          <a className="title-font" href={`#/work/${m.id}`}>
            {m.title || m.kind}
          </a>
          <span className="archive-row__memo muted">{[m.announcements, m.decisions].join(' ').slice(0, 80)}</span>
          {m.archived ? (
            <button className="btn btn--sm" onClick={() => void repo.update<MeetingNote>('meetings', m.id, { archived: false })}>
              <ArchiveRestore size={16} /> 꺼내기
            </button>
          ) : (
            <span className="chip">사용 중</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function PageArchive({ items }: { items: WorkspacePage[] }) {
  if (!items.length) return <EmptyState text="보관한 페이지가 없어. 페이지에서 보관 버튼을 누르면 여기로 와." />;
  return (
    <ul className="list-reset card archive-list archive-list--card">
      {items.map((p) => (
        <li key={p.id} className="archive-row archive-row--static">
          <span className="archive-row__date">{formatShort(p.updatedAt.slice(0, 10))}</span>
          <a className="title-font" href={p.template === 'board' ? `#/board/${p.id}` : `#/pages/${p.id}`}>
            {p.title}
          </a>
          <span className="spacer" />
          <button
            className="btn btn--sm"
            onClick={async () => {
              await repo.update<WorkspacePage>('pages', p.id, { archived: false });
              toast('페이지를 꺼냈어요.');
            }}
          >
            <ArchiveRestore size={16} /> 꺼내기
          </button>
          <button
            className="icon-btn"
            aria-label={`${p.title} 영구 삭제`}
            onClick={async () => {
              if (await confirmDialog({ title: '영구 삭제', message: `"${p.title}"을(를) 완전히 지울까요? 되돌릴 수 없어요.`, confirmLabel: '영구 삭제', danger: true })) await deletePage(p);
            }}
          >
            <Trash2 size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function NoteArchive({ items }: { items: Note[] }) {
  if (!items.length) return <EmptyState text="빠른 메모가 없어. Today 화면에서 바로 남길 수 있어." />;
  return (
    <ul className="list-reset note-wall">
      {items.map((n) => (
        <li key={n.id} className="note-sticky">
          <span className="note-sticky__date title-font">{formatShort(n.date)}</span>
          <p>{n.text}</p>
          <button
            className="icon-btn note-sticky__del"
            aria-label="메모 삭제"
            onClick={async () => {
              if (await confirmDialog({ title: '메모 삭제', message: '이 메모를 지울까요?', confirmLabel: '삭제', danger: true })) {
                await repo.remove('notes', n.id);
                toast('메모를 지웠어요.', { label: '되돌리기', run: () => void repo.put('notes', n) });
              }
            }}
          >
            <Trash2 size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}
