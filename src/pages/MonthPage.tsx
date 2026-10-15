import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarPlus, ChevronLeft, ChevronRight, Plus, Send, Trash2 } from 'lucide-react';
import { db } from '../services/localDb';
import * as repo from '../services/repo';
import { useSettings } from '../hooks/useData';
import { navigate, useRoute } from '../hooks/useRoute';
import { addMonths, formatKo, monthMatrix, parseISODate, todayISO } from '../utils/date';
import { holidayName } from '../data/holidays';
import type { CalendarEvent, CategoryId, Note, Settings } from '../types';
import { cx } from '../utils/id';
import { Drawer, confirmDialog, toast } from '../components/common/overlays';
import { AutoInput, AutoTextarea } from '../components/common/fields';
import { AttachmentBar } from '../components/common/Attachments';
import { EmptyState } from '../components/common/EmptyState';
import { openLesson } from '../components/planner/lessonDrawerStore';
import { appsScriptCalendar } from '../services/calendar/googleCalendar';
import { getNeisService, type SchoolScheduleItem } from '../services/neis/neis';
import { useMediaQuery } from '../hooks/useMediaQuery';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export function MonthPage() {
  const s = useSettings();
  const route = useRoute();
  const today = todayISO();
  const selected = route.query.get('d') ?? today;
  const [cursor, setCursor] = useState(() => selected.slice(0, 7) + '-01');
  useEffect(() => setCursor(selected.slice(0, 7) + '-01'), [selected]);
  const cur = parseISODate(cursor);
  const weeks = monthMatrix(cur.getFullYear(), cur.getMonth());
  const from = weeks[0][0];
  const to = weeks[weeks.length - 1][6];
  const [hidden, setHidden] = useState<Set<CategoryId>>(new Set());
  const wide = useMediaQuery('(min-width: 1180px)');
  const [panelOpen, setPanelOpen] = useState(false);

  const events = useLiveQuery(() => db.events.where('date').between(from, to, true, true).toArray(), [from, to]) ?? [];
  const lessonsCount = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.lessons.where('date').between(from, to, true, true).each((l) => m.set(l.date, (m.get(l.date) ?? 0) + 1));
    return m;
  }, [from, to]);
  const dayNotes = useLiveQuery(async () => new Set((await db.notes.where('date').between(from, to, true, true).filter((n) => n.kind === 'day').toArray()).map((n) => n.date)), [from, to]);
  const [neis, setNeis] = useState<SchoolScheduleItem[]>([]);
  useEffect(() => {
    getNeisService(s).schedule(from, to).then(setNeis).catch(() => setNeis([]));
  }, [s, from, to]);

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (hidden.has(e.category)) continue;
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    m.forEach((l) => l.sort((a, b) => (a.time ?? '') < (b.time ?? '') ? -1 : 1));
    return m;
  }, [events, hidden]);

  const pick = (d: string) => {
    navigate(`month?d=${d}`);
    if (!wide) setPanelOpen(true);
  };
  const year = cur.getFullYear();
  const catColor = (id: string) => s.categories.find((c) => c.id === id)?.color;

  return (
    <div className={cx('month', wide && 'month--wide')}>
      <div className="month__main">
        <div className="page-head">
          <div className="month__title">
            <span className="month__year title-font">{year}</span>
            <h1 className="page-head__title">{cur.getMonth() + 1}월</h1>
          </div>
          <div className="page-head__actions">
            <select className="select month__year-select" value={year} onChange={(e) => setCursor(`${e.target.value}-${String(cur.getMonth() + 1).padStart(2, '0')}-01`)} aria-label="연도">
              {Array.from(new Set([2026, 2027, year - 1, year, year + 1]))
                .sort()
                .map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
            </select>
            <button className="icon-btn icon-btn--outline" onClick={() => setCursor(addMonths(cursor, -1))} aria-label="이전 달">
              <ChevronLeft size={20} />
            </button>
            <button className="btn btn--sm" onClick={() => pick(today)}>
              오늘
            </button>
            <button className="icon-btn icon-btn--outline" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="다음 달">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        <div className="row row--wrap cat-filter" role="group" aria-label="카테고리 보기">
          {s.categories.map((c) => (
            <button
              key={c.id}
              className={cx('chip chip--dot', hidden.has(c.id) && 'is-off')}
              style={{ ['--chip-color' as string]: c.color }}
              aria-pressed={!hidden.has(c.id)}
              onClick={() => {
                const n = new Set(hidden);
                if (n.has(c.id)) n.delete(c.id);
                else n.add(c.id);
                setHidden(n);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="cal" role="grid" aria-label={`${year}년 ${cur.getMonth() + 1}월`}>
          {DOW.map((d, i) => (
            <div key={d} className={cx('cal__dow title-font', i === 0 && 'is-sun', i === 6 && 'is-sat')} role="columnheader">
              {d}
            </div>
          ))}
          {weeks.flat().map((d, i) => {
            const dt = parseISODate(d);
            const inMonth = dt.getMonth() === cur.getMonth();
            const hol = holidayName(d);
            const list = byDate.get(d) ?? [];
            const school = neis.filter((n) => n.date === d);
            const lc = lessonsCount?.get(d) ?? 0;
            return (
              <button
                key={d}
                role="gridcell"
                className={cx('cal__day', !inMonth && 'is-out', d === today && 'is-today', d === selected && 'is-selected', (i % 7 === 0 || hol) && 'is-sun', i % 7 === 6 && 'is-sat')}
                onClick={() => pick(d)}
                aria-label={`${formatKo(d)}${hol ? ` ${hol}` : ''}, 일정 ${list.length}개`}
              >
                <span className="cal__num">{dt.getDate()}</span>
                {hol && <span className="cal__hol">{hol}</span>}
                <span className="cal__events">
                  {school.slice(0, 1).map((n) => (
                    <span key={n.name} className="cal__ev cal__ev--school">
                      {n.name}
                    </span>
                  ))}
                  {list.slice(0, 3).map((e) => (
                    <span key={e.id} className="cal__ev" style={{ ['--ev' as string]: catColor(e.category) }}>
                      {e.title}
                    </span>
                  ))}
                  {list.length > 3 && <span className="cal__more">+{list.length - 3}</span>}
                </span>
                <span className="cal__marks">
                  {lc > 0 && <span className="cal__lessons" title={`수업 ${lc}개`}>{lc}</span>}
                  {dayNotes?.has(d) && <span className="cal__note" title="메모 있음">✎</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {wide ? (
        <aside className="month__panel card" aria-label="선택한 날짜">
          <DayPanel s={s} date={selected} key={selected} />
        </aside>
      ) : (
        <Drawer open={panelOpen} onClose={() => setPanelOpen(false)} title={<span className="title-font">{formatKo(selected)}</span>} label="날짜 상세">
          <DayPanel s={s} date={selected} key={selected} hideTitle />
        </Drawer>
      )}
    </div>
  );
}

function DayPanel({ s, date, hideTitle }: { s: Settings; date: string; hideTitle?: boolean }) {
  const events = useLiveQuery(() => db.events.where('date').equals(date).toArray(), [date]) ?? [];
  const note = useLiveQuery(async () => (await db.notes.where('date').equals(date).filter((n) => n.kind === 'day').first()) ?? null, [date]);
  const lessons = useLiveQuery(() => db.lessons.where('date').equals(date).sortBy('period'), [date]) ?? [];
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<CategoryId>('work');
  const [time, setTime] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const hol = holidayName(date);
  const noteCreating = useRef<Promise<Note> | null>(null);
  const ensureNote = async () => {
    if (note) return note;
    noteCreating.current ??= repo.create<Note>('notes', { kind: 'day', date, text: '', attachments: [] });
    return noteCreating.current;
  };

  return (
    <div className="day-panel">
      {!hideTitle && (
        <div className="day-panel__head">
          <h2 className="title-font">{formatKo(date)}</h2>
          {hol && <span className="stamp stamp--pink">{hol}</span>}
        </div>
      )}

      <form
        className="event-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          await repo.create<CalendarEvent>('events', { date, title: title.trim(), category, time: time || undefined, attachments: [] });
          setTitle('');
          setTime('');
          titleRef.current?.focus();
        }}
      >
        <input ref={titleRef} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="일정 추가" aria-label="일정 제목" />
        <div className="row row--wrap">
          <select className="select event-form__cat" value={category} onChange={(e) => setCategory(e.target.value as CategoryId)} aria-label="카테고리">
            {s.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input type="time" className="input event-form__time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="시간" />
          <button className="btn btn--primary" disabled={!title.trim()}>
            <Plus size={18} /> 추가
          </button>
        </div>
      </form>

      <section>
        <h3 className="section-title">일정</h3>
        {events.length === 0 ? (
          <EmptyState text="이 날은 아직 일정이 없어." avatar={false} />
        ) : (
          <ul className="list-reset day-events">
            {events.map((e) => (
              <EventRow key={e.id} s={s} e={e} />
            ))}
          </ul>
        )}
      </section>

      {lessons.length > 0 && (
        <section>
          <h3 className="section-title">수업</h3>
          <ul className="list-reset day-lessons">
            {lessons.map((l) => (
              <li key={l.id}>
                <button className="chip chip--dot" style={{ ['--chip-color' as string]: l.completed ? 'var(--blue)' : 'var(--orange)' }} onClick={() => openLesson({ recordId: l.id })}>
                  {l.classKey} {l.lesson || '계획 없음'} {l.session ? `${l.session}차시` : ''}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="day-panel__note">
        <h3 className="section-title">짧은 메모</h3>
        <AutoTextarea
          saveKey={`day:${date}`}
          value={note?.text ?? ''}
          onSave={async (text) => {
            const n = await ensureNote();
            await repo.update<Note>('notes', n.id, { text });
          }}
          lined
          rows={4}
          placeholder="이 날의 메모"
        />
        <AttachmentBar
          ids={note?.attachments ?? []}
          owner={{ type: 'dayNote', id: note?.id ?? date }}
          onChange={async (attachments) => {
            const n = await ensureNote();
            await repo.update<Note>('notes', n.id, { attachments });
          }}
        />
      </section>
    </div>
  );
}

function EventRow({ s, e }: { s: Settings; e: CalendarEvent }) {
  const [open, setOpen] = useState(false);
  const cat = s.categories.find((c) => c.id === e.category);
  return (
    <li className={cx('day-event', open && 'is-open')} style={{ ['--ev' as string]: cat?.color }}>
      <button className="day-event__summary" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="day-event__bar" />
        <span className="day-event__title">
          {e.time && <span className="muted">{e.time} </span>}
          {e.title}
        </span>
        <span className="chip">{cat?.label}</span>
      </button>
      {open && (
        <div className="day-event__edit stack">
          <AutoInput saveKey={`${e.id}:title`} value={e.title} onSave={(title) => repo.update<CalendarEvent>('events', e.id, { title })} aria-label="일정 제목" />
          <div className="row row--wrap">
            <select className="select event-form__cat" value={e.category} onChange={(ev) => void repo.update<CalendarEvent>('events', e.id, { category: ev.target.value as CategoryId })} aria-label="카테고리">
              {s.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input type="time" className="input event-form__time" value={e.time ?? ''} onChange={(ev) => void repo.update<CalendarEvent>('events', e.id, { time: ev.target.value || undefined })} aria-label="시간" />
            <input type="date" className="input event-form__time" value={e.date} onChange={(ev) => ev.target.value && void repo.update<CalendarEvent>('events', e.id, { date: ev.target.value })} aria-label="날짜" />
          </div>
          <AutoTextarea saveKey={`${e.id}:memo`} value={e.memo ?? ''} onSave={(memo) => repo.update<CalendarEvent>('events', e.id, { memo })} rows={2} placeholder="메모" />
          <AttachmentBar ids={e.attachments} owner={{ type: 'event', id: e.id }} onChange={(attachments) => repo.update<CalendarEvent>('events', e.id, { attachments })} />
          <div className="row row--wrap">
            <button
              className="btn btn--sm"
              onClick={async () => {
                if (!(await appsScriptCalendar.isAvailable())) {
                  toast('설정에서 Google 동기화를 연결하면 Calendar로 보낼 수 있어요.');
                  return;
                }
                if (!(await confirmDialog({ title: 'Google Calendar로 보내기', message: `"${e.title}" 일정을 내 Google Calendar에 ${e.gcalEventId ? '다시 ' : ''}보낼까요?`, confirmLabel: '보내기' }))) return;
                try {
                  const { eventId } = await appsScriptCalendar.pushEvent(e);
                  await repo.update<CalendarEvent>('events', e.id, { gcalEventId: eventId });
                  toast('Google Calendar에 보냈어요.');
                } catch (err) {
                  toast((err as Error).message);
                }
              }}
            >
              {e.gcalEventId ? <Send size={16} /> : <CalendarPlus size={16} />} {e.gcalEventId ? 'Calendar 업데이트' : 'Google Calendar로 보내기'}
            </button>
            <span className="spacer" />
            <button
              className="btn btn--sm btn--ghost"
              onClick={async () => {
                if (await confirmDialog({ title: '일정 삭제', message: `"${e.title}"을(를) 삭제할까요?`, confirmLabel: '삭제', danger: true })) {
                  await repo.remove('events', e.id);
                  toast('일정을 삭제했어요.', { label: '되돌리기', run: () => void repo.put('events', e) });
                }
              }}
            >
              <Trash2 size={16} /> 삭제
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
