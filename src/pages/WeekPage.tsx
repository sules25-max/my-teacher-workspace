import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { db } from '../services/localDb';
import { useSettings } from '../hooks/useData';
import { navigate, useRoute } from '../hooks/useRoute';
import { openLesson } from '../components/planner/lessonDrawerStore';
import { setLessonCompleted, slotKey } from '../services/planner';
import { WEEKDAY_KO, addDays, dateOfWeekday, formatMonthDay, isoWeekday, parseISODate, startOfWeek, todayISO } from '../utils/date';
import { holidayName } from '../data/holidays';
import type { LessonRecord, PeriodSlot, Settings } from '../types';
import { cx } from '../utils/id';
import { PixelIcon } from '../components/common/Deco';
import { toast } from '../components/common/overlays';

export function WeekPage() {
  const s = useSettings();
  const route = useRoute();
  const today = todayISO();
  const weekStart = startOfWeek(route.query.get('d') ?? today);
  const days = s.weekdays.map((wd) => ({ wd, date: dateOfWeekday(weekStart, wd) }));
  const weekEnd = days[days.length - 1]?.date ?? weekStart;

  const records = useLiveQuery(() => db.lessons.where('date').between(weekStart, addDays(weekStart, 6), true, true).toArray(), [weekStart]) ?? [];
  const byCell = useMemo(() => {
    const m = new Map<string, LessonRecord>();
    for (const r of records) m.set(`${r.date}:${r.periodId}`, r);
    return m;
  }, [records]);

  const [mobileDay, setMobileDay] = useState(() => Math.max(0, s.weekdays.indexOf(isoWeekday(today))));
  const go = (d: string) => navigate(`week?d=${d}`);
  const isThisWeek = weekStart === startOfWeek(today);
  const planned = records.filter((r) => r.lesson).length;
  const done = records.filter((r) => r.completed).length;
  const ws = parseISODate(weekStart);

  return (
    <div className="week">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {ws.getMonth() + 1}월 {Math.ceil((ws.getDate() + new Date(ws.getFullYear(), ws.getMonth(), 1).getDay()) / 7)}주
          </h1>
          <p className="page-head__sub">
            {formatMonthDay(weekStart)} – {formatMonthDay(weekEnd)} · 계획 {planned} · 완료 {done}
          </p>
        </div>
        <div className="page-head__actions">
          <button className="icon-btn icon-btn--outline" onClick={() => go(addDays(weekStart, -7))} aria-label="지난주">
            <ChevronLeft size={20} />
          </button>
          <button className="btn btn--sm" onClick={() => go(today)} disabled={isThisWeek}>
            이번 주
          </button>
          <button className="icon-btn icon-btn--outline" onClick={() => go(addDays(weekStart, 7))} aria-label="다음 주">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {Object.keys(s.timetable).length === 0 && (
        <div className="notice">
          <PixelIcon kind="bang" size={14} color="var(--pink)" />
          정기 시간표가 비어 있어요. 칸을 눌러 바로 수업을 넣거나, <a href="#/settings?tab=timetable">설정 → 시간표</a>에서 반을 지정하면 매주 자동으로 채워져요.
        </div>
      )}

      {/* 태블릿 · 데스크톱: 플래너 격자 */}
      <div className="planner-paper">
        <div className="planner" style={{ gridTemplateColumns: `minmax(64px, 92px) repeat(${days.length}, minmax(0, 1fr))` }} role="grid" aria-label="주간 수업 계획">
          <div className="planner__corner" />
          {days.map(({ wd, date }) => {
            const hol = holidayName(date);
            return (
              <div key={date} className={cx('planner__day', date === today && 'is-today', hol && 'is-holiday')} role="columnheader">
                <span className="planner__wd title-font">{WEEKDAY_KO[wd]}</span>
                <span className="planner__date">{parseISODate(date).getDate()}</span>
                {hol && <span className="planner__hol">{hol}</span>}
              </div>
            );
          })}
          {s.periods.map((p) => (
            <PeriodRow key={p.id} s={s} p={p} days={days} byCell={byCell} today={today} />
          ))}
        </div>
      </div>

      {/* iPhone: 하루씩 보기 */}
      <div className="week-mobile">
        <div className="seg week-mobile__days" role="tablist">
          {days.map(({ wd, date }, i) => (
            <button key={date} role="tab" aria-pressed={i === mobileDay} aria-selected={i === mobileDay} onClick={() => setMobileDay(i)}>
              {WEEKDAY_KO[wd]} {parseISODate(date).getDate()}
            </button>
          ))}
        </div>
        {days[mobileDay] && (
          <ul className="list-reset day-list">
            {s.periods.map((p) => {
              const { date, wd } = days[mobileDay];
              return (
                <li key={p.id}>
                  <div className="day-list__period">
                    <span className="title-font">{p.short}</span>
                    {p.grades && <span className="muted">{p.grades.join('·')}학년</span>}
                  </div>
                  <LessonCell s={s} date={date} wd={wd} p={p} rec={byCell.get(`${date}:${p.id}`)} today={today} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function PeriodRow({ s, p, days, byCell, today }: { s: Settings; p: PeriodSlot; days: { wd: number; date: string }[]; byCell: Map<string, LessonRecord>; today: string }) {
  return (
    <>
      <div className="planner__period" role="rowheader">
        <span className="title-font">{p.short}</span>
        {p.grades && <span className="planner__grades">{p.grades.join('·')}학년</span>}
        {p.start && <span className="planner__time">{p.start}</span>}
      </div>
      {days.map(({ wd, date }) => (
        <div key={date} className={cx('planner__cell', date === today && 'is-today')} role="gridcell">
          <LessonCell s={s} date={date} wd={wd} p={p} rec={byCell.get(`${date}:${p.id}`)} today={today} />
        </div>
      ))}
    </>
  );
}

export function LessonCell({ s, date, wd, p, rec, today }: { s: Settings; date: string; wd: number; p: PeriodSlot; rec?: LessonRecord; today: string }) {
  const tt = s.timetable[slotKey(wd, p.id)];
  const cls = rec?.classKey ?? tt;
  const open = () => openLesson(rec ? { recordId: rec.id } : { date, periodId: p.id });
  if (!cls) {
    return (
      <button className="lesson-cell lesson-cell--empty" onClick={open} aria-label={`${date} ${p.label} 수업 추가`}>
        <Plus size={16} />
      </button>
    );
  }
  const past = date < today;
  return (
    <div className={cx('lesson-cell', rec?.completed && 'is-done', !rec?.lesson && 'is-unplanned', past && !rec?.completed && rec?.lesson && 'is-missed')} data-grade={cls.split('-')[0]}>
      <button className="lesson-cell__main" onClick={open}>
        <span className="lesson-cell__class title-font">{cls}</span>
        {rec?.lesson ? (
          <>
            <span className="lesson-cell__lesson">{rec.lesson}</span>
            <span className="lesson-cell__session">
              {rec.session} / {rec.totalSessions ?? '?'}차시
            </span>
          </>
        ) : (
          <span className="lesson-cell__hint">+ 계획</span>
        )}
        {rec?.memo && <span className="lesson-cell__memo">{rec.memo}</span>}
      </button>
      {rec?.lesson && (
        <button
          className="lesson-cell__check"
          aria-pressed={rec.completed}
          aria-label={rec.completed ? `${cls} 수업 완료 취소` : `${cls} 수업 완료`}
          onClick={async () => {
            const { progressChanged } = await setLessonCompleted(rec, !rec.completed);
            if (!rec.completed && progressChanged) toast(`${cls} ${rec.lesson} ${rec.session}차시 완료 · 진도표 반영`, { label: '되돌리기', run: () => void setLessonCompleted({ ...rec, completed: true }, false) });
          }}
        >
          {rec.completed ? <Check size={16} strokeWidth={3} /> : null}
        </button>
      )}
    </div>
  );
}
