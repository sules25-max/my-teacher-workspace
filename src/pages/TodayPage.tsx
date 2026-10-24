import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Check, Plus, Send } from 'lucide-react';
import { db } from '../services/localDb';
import * as repo from '../services/repo';
import { useSettings } from '../hooks/useData';
import { navigate } from '../hooks/useRoute';
import { openLesson } from '../components/planner/lessonDrawerStore';
import { effectiveSlot, loadOverrides, setLessonCompleted, suggestNextFor, type Suggestion } from '../services/planner';
import { addTask, sortTasks, taskBucket } from '../services/tasks';
import { openMeteoWeather, type WeatherNow } from '../services/weather/weather';
import { TaskItem } from '../components/tasks/TaskItem';
import { openDailySummary } from '../components/assistant/DailySummary';
import { EmptyState } from '../components/common/EmptyState';
import { Deco, PixelIcon } from '../components/common/Deco';
import { toast } from '../components/common/overlays';
import { addDays, formatEn, formatKo, formatShort, greeting, isoWeekday, todayISO } from '../utils/date';
import { holidayName } from '../data/holidays';
import type { LessonRecord, Note, Settings } from '../types';
import { cx } from '../utils/id';

export function TodayPage() {
  const s = useSettings();
  const today = todayISO();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  const hol = holidayName(today);

  return (
    <div className="today">
      <section className="hero card">
        <Deco kind="plus" size={10} style={{ top: 7, left: 7 }} />
        <Deco kind="star" size={18} color="var(--orange)" style={{ top: 18, right: 22 }} />
        <Deco kind="plus" size={10} style={{ bottom: 18, right: 120 }} />
        <div className="hero__text">
          <p className="hero__greet title-font">{greeting(now)}</p>
          <h1 className="hero__date">{formatEn(today)}</h1>
          <p className="hero__ko">
            {formatKo(today)}
            {hol && <span className="stamp stamp--pink hero__hol">{hol}</span>}
          </p>
        </div>
        <div className="hero__side">
          <WeatherWidget s={s} />
          <button className="btn btn--sm btn--title hero__daily" onClick={openDailySummary}>
            ✨ 오늘 하루 정리
          </button>
        </div>
      </section>

      <div className="today-grid">
        <TodayLessons s={s} today={today} />
        <TodayTasks today={today} />
        <QuickNote today={today} />
        <Upcoming today={today} s={s} />
        <RecentMemos />
      </div>
    </div>
  );
}

function WeatherWidget({ s }: { s: Settings }) {
  const [w, setW] = useState<WeatherNow | null>(null);
  useEffect(() => {
    if (!s.weather.enabled) return;
    openMeteoWeather.current(s.weather.lat, s.weather.lon).then(setW);
  }, [s.weather.enabled, s.weather.lat, s.weather.lon]);
  if (!w) return null;
  return (
    <div className="weather" title={`${s.weather.label} · ${w.label}`}>
      <span className="weather__icon" aria-hidden="true">
        {w.icon}
      </span>
      <span className="weather__temp title-font">{w.temp}°C</span>
      <span className="sr-only">
        {s.weather.label} {w.label}
      </span>
    </div>
  );
}

function TodayLessons({ s, today }: { s: Settings; today: string }) {
  const wd = isoWeekday(today);
  const records = useLiveQuery(() => db.lessons.where('date').equals(today).toArray(), [today]) ?? [];
  const overrides = useLiveQuery(() => loadOverrides(today, today), [today]);
  const rows = s.periods
    .map((p) => {
      const rec = records.find((r) => r.periodId === p.id);
      // 정기 시간표 + 이번 주 변경(반 바꾸기 · 휴강)
      const cls = rec?.classKey ?? effectiveSlot(s, today, p.id, overrides).classKey;
      return cls ? { p, rec, cls } : null;
    })
    .filter(Boolean) as { p: Settings['periods'][number]; rec?: LessonRecord; cls: string }[];

  const nowHM = new Date().toTimeString().slice(0, 5);
  const currentIdx = rows.findIndex((r) => !r.p.end || r.p.end >= nowHM);
  const doneCount = rows.filter((r) => r.rec?.completed).length;

  return (
    <section className="card today-lessons" aria-labelledby="today-lessons-title">
      <div className="card__head">
        <h2 className="card__title" id="today-lessons-title">
          <PixelIcon kind="star" size={14} color="var(--blue)" /> 오늘 수업
        </h2>
        {rows.length > 0 && (
          <span className="chip">
            {doneCount} / {rows.length} 완료
          </span>
        )}
      </div>
      <div className="card__body">
        {rows.length === 0 ? (
          <EmptyState
            text={s.weekdays.includes(wd) ? '오늘은 등록된 수업이 없어.' : '오늘은 수업 없는 날이야. 푹 쉬어!'}
            expression="happy"
            action={
              <button className="btn btn--sm" onClick={() => navigate('week')}>
                주간 계획 열기
              </button>
            }
          />
        ) : (
          <ol className="list-reset lesson-rows">
            {rows.map(({ p, rec, cls }, i) => (
              <TodayLessonRow key={p.id} s={s} p={p} rec={rec} cls={cls} date={today} current={i === currentIdx} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function TodayLessonRow({ s, p, rec, cls, date, current }: { s: Settings; p: Settings['periods'][number]; rec?: LessonRecord; cls: string; date: string; current: boolean }) {
  const [sug, setSug] = useState<Suggestion | null>(null);
  useEffect(() => {
    if (rec?.lesson) return;
    suggestNextFor(s, cls, date, p.id).then(setSug);
  }, [s, cls, date, p.id, rec?.lesson]);
  return (
    <li className={cx('lesson-row', rec?.completed && 'is-done', current && 'is-current')}>
      <span className="lesson-row__period">
        <span className="title-font">{p.short}</span>
        {p.start && <span className="lesson-row__time">{p.start}</span>}
      </span>
      <button
        className="lesson-row__main"
        onClick={() => openLesson(rec ? { recordId: rec.id } : { date, periodId: p.id })}
        aria-label={`${p.short} ${cls} ${rec?.lesson ? `${rec.lesson} ${rec.session}차시` : '수업 카드 열기'}`}
      >
        <span className="lesson-row__class title-font">{cls}</span>
        {rec?.lesson ? (
          <span className="lesson-row__lesson">
            {rec.lesson} · <b>{rec.session} / {rec.totalSessions ?? '?'}차시</b>
          </span>
        ) : (
          <span className="lesson-row__lesson muted">{sug ? `제안: ${sug.lesson} ${sug.session}차시` : '계획 없음'}</span>
        )}
      </button>
      {rec?.lesson ? (
        <button
          className={cx('lesson-row__done', rec.completed && 'is-on')}
          aria-pressed={rec.completed}
          aria-label={rec.completed ? '완료 취소' : '수업 완료'}
          onClick={async () => {
            const { progressChanged } = await setLessonCompleted(rec, !rec.completed);
            if (!rec.completed && progressChanged) toast(`${cls} 진도표에 반영했어요.`, { label: '되돌리기', run: () => void setLessonCompleted({ ...rec, completed: true }, false) });
          }}
        >
          <Check size={20} strokeWidth={3} />
        </button>
      ) : (
        <span className="lesson-row__done-spacer" />
      )}
    </li>
  );
}

function TodayTasks({ today }: { today: string }) {
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) ?? [];
  const list = tasks
    .filter((t) => {
      const b = taskBucket(t, today);
      return b === 'overdue' || b === 'today' || (b !== 'done' && t.important) || (t.completed && t.completedAt?.slice(0, 10) === today);
    })
    .sort((a, b) => Number(a.completed) - Number(b.completed) || sortTasks(a, b));
  const [text, setText] = useState('');
  return (
    <section className="card today-tasks" aria-labelledby="today-tasks-title">
      <div className="card__head">
        <h2 className="card__title" id="today-tasks-title">
          <PixelIcon kind="bang" size={14} color="var(--pink)" /> 오늘 할 일
        </h2>
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('tasks')}>
          전체 <ArrowRight size={16} />
        </button>
      </div>
      <div className="card__body">
        <form
          className="row quick-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            await addTask({ title: text, dueDate: today });
            setText('');
          }}
        >
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="오늘 할 일 추가" aria-label="오늘 할 일 추가" enterKeyHint="done" />
          <button className="icon-btn icon-btn--outline" aria-label="추가" disabled={!text.trim()}>
            <Plus size={20} />
          </button>
        </form>
        {list.length === 0 ? (
          <EmptyState text="오늘 마감인 일이 없어. 여유로운 하루!" expression="confident" />
        ) : (
          <ul className="list-reset task-list">
            {list.map((t) => (
              <TaskItem key={t.id} task={t} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function QuickNote({ today }: { today: string }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const save = async () => {
    if (!text.trim()) return;
    await repo.create<Note>('notes', { kind: 'quick', date: today, text: text.trim(), attachments: [] });
    setText('');
    toast('메모를 남겼어요.');
  };
  return (
    <section className="card card--blue quick-note" aria-labelledby="quick-note-title">
      <div className="card__head">
        <h2 className="card__title" id="quick-note-title">
          <PixelIcon kind="dots" size={18} color="var(--navy)" /> Quick Note
        </h2>
      </div>
      <div className="card__body">
        <textarea
          ref={ref}
          className="textarea textarea--lined"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
          }}
          placeholder="생각난 걸 바로 적어두기…"
          rows={3}
          aria-label="빠른 메모"
        />
        <div className="row row--between quick-note__foot">
          <span className="muted quick-note__hint">⌘/Ctrl + Enter로 저장</span>
          <button className="btn btn--sm btn--primary" onClick={save} disabled={!text.trim()}>
            <Send size={16} /> 남기기
          </button>
        </div>
      </div>
    </section>
  );
}

function Upcoming({ today, s }: { today: string; s: Settings }) {
  const events = useLiveQuery(() => db.events.where('date').between(today, addDays(today, 14), true, true).sortBy('date'), [today]) ?? [];
  const cat = (id: string) => s.categories.find((c) => c.id === id);
  return (
    <section className="card upcoming" aria-labelledby="upcoming-title">
      <div className="card__head">
        <h2 className="card__title" id="upcoming-title">
          <PixelIcon kind="heart" size={14} color="var(--pink)" /> 가까운 일정
        </h2>
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('month')}>
          달력 <ArrowRight size={16} />
        </button>
      </div>
      <div className="card__body">
        {events.length === 0 ? (
          <EmptyState text="2주 안에 잡힌 일정이 없어." avatar={false} />
        ) : (
          <ul className="list-reset event-list">
            {events.slice(0, 6).map((e) => (
              <li key={e.id}>
                <button className="event-row" onClick={() => navigate(`month?d=${e.date}`)}>
                  <span className={cx('event-row__date', e.date === today && 'is-today')}>{e.date === today ? '오늘' : formatShort(e.date)}</span>
                  <span className="chip chip--dot" style={{ ['--chip-color' as string]: cat(e.category)?.color }}>
                    {cat(e.category)?.label}
                  </span>
                  <span className="event-row__title">
                    {e.time && <span className="muted">{e.time} </span>}
                    {e.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface MemoItem {
  id: string;
  kind: string;
  title: string;
  text: string;
  at: string;
  open: () => void;
}

function RecentMemos() {
  const data = useLiveQuery(async () => {
    const [notes, lessons, meetings] = await Promise.all([
      db.notes.orderBy('updatedAt').reverse().limit(8).toArray(),
      db.lessons.orderBy('updatedAt').reverse().filter((l) => !!l.memo?.trim()).limit(6).toArray(),
      db.meetings.orderBy('updatedAt').reverse().limit(4).toArray(),
    ]);
    return { notes, lessons, meetings };
  }, []);
  const items: MemoItem[] = useMemo(() => {
    if (!data) return [];
    return [
      ...data.notes.filter((n) => n.text.trim()).map((n) => ({ id: n.id, kind: { quick: '메모', day: '날짜 메모', summary: '하루 정리', inbox: 'AI Inbox' }[n.kind], title: formatShort(n.date), text: n.text, at: n.updatedAt, open: () => navigate(n.kind === 'day' ? `month?d=${n.date}` : 'archive?tab=notes') })),
      ...data.lessons.map((l) => ({ id: l.id, kind: '수업', title: `${l.classKey} ${l.lesson} ${l.session}차시`, text: l.memo ?? '', at: l.updatedAt, open: () => openLesson({ recordId: l.id }) })),
      ...data.meetings.map((m) => ({ id: m.id, kind: '회의', title: m.title, text: [m.announcements, m.decisions, m.memo].filter(Boolean).join(' · '), at: m.updatedAt, open: () => navigate(`work/${m.id}`) })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 6);
  }, [data]);

  return (
    <section className="card recent" aria-labelledby="recent-title">
      <div className="card__head">
        <h2 className="card__title" id="recent-title">
          <PixelIcon kind="sparkle" size={14} color="var(--orange)" /> 최근 메모
        </h2>
      </div>
      <div className="card__body">
        {items.length === 0 ? (
          <EmptyState text="아직 남긴 메모가 없어." expression="shy" />
        ) : (
          <ul className="list-reset memo-list">
            {items.map((m) => (
              <li key={m.id}>
                <button className="memo-row" onClick={m.open}>
                  <span className="stamp stamp--blue memo-row__kind">{m.kind}</span>
                  <span className="memo-row__body">
                    <span className="memo-row__title">{m.title}</span>
                    <span className="memo-row__text">{m.text || '내용 없음'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
