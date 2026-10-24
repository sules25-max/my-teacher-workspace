import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, RotateCcw } from 'lucide-react';
import { db } from '../services/localDb';
import { useSettings } from '../hooks/useData';
import { navigate, useRoute } from '../hooks/useRoute';
import { openLesson } from '../components/planner/lessonDrawerStore';
import { allClasses, effectiveSlot, loadOverrides, moveLessonSlot, normalizeClassInput, periodAllowsGrade, setLessonCompleted, setSlotOverride, type EffectiveSlot, type OverrideMap, type SlotRef } from '../services/planner';
import { useLessonDrag } from '../components/planner/useLessonDrag';
import { changeSlotClass } from '../components/planner/slotChange';
import { WEEKDAY_KO, addDays, dateOfWeekday, formatMonthDay, isoWeekday, parseISODate, startOfWeek, todayISO } from '../utils/date';
import { holidayName } from '../data/holidays';
import type { LessonRecord, PeriodSlot, Settings } from '../types';
import { cx } from '../utils/id';
import { PixelIcon } from '../components/common/Deco';
import { confirmDialog, promptDialog, toast } from '../components/common/overlays';

export function WeekPage() {
  const s = useSettings();
  const route = useRoute();
  const today = todayISO();
  const weekStart = startOfWeek(route.query.get('d') ?? today);
  const days = s.weekdays.map((wd) => ({ wd, date: dateOfWeekday(weekStart, wd) }));
  const weekEnd = days[days.length - 1]?.date ?? weekStart;
  const [editing, setEditing] = useState(false);

  const records = useLiveQuery(() => db.lessons.where('date').between(weekStart, addDays(weekStart, 6), true, true).toArray(), [weekStart]) ?? [];
  const overrides = useLiveQuery(() => loadOverrides(weekStart, addDays(weekStart, 6)), [weekStart]) ?? new Map();
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
  const changedCount = overrides.size;

  // 갑작스런 수업 변경: 칸을 끌어 다른 칸에 놓으면 옮기고, 대상 칸에 수업이 있으면 서로 바꾼다
  const { drag, handleProps } = useLessonDrag(async (from, to) => {
    const label = (r: SlotRef) => `${WEEKDAY_KO[isoWeekday(r.date)]} ${s.periods.find((p) => p.id === r.periodId)?.short ?? ''}`;
    const toRec = byCell.get(`${to.date}:${to.periodId}`);
    const toCls = toRec?.classKey ?? effectiveSlot(s, to.date, to.periodId, overrides).classKey;
    const fromCls = byCell.get(`${from.date}:${from.periodId}`)?.classKey ?? effectiveSlot(s, from.date, from.periodId, overrides).classKey;
    if (toCls && !(await confirmDialog({ title: '수업 교환', message: `${label(from)} ${fromCls} ↔ ${label(to)} ${toCls}\n두 수업을 서로 바꿀까요? (이번 주만, 수업 기록도 함께 옮겨져요)`, confirmLabel: '바꾸기' }))) return;
    try {
      const r = await moveLessonSlot(s, from, to);
      toast(r.swapped ? `${label(from)} ↔ ${label(to)} 교환했어요.` : `${r.fromClass} 수업을 ${label(to)}(으)로 옮겼어요.`, { label: '되돌리기', run: () => void moveLessonSlot(s, to, from).catch((e) => toast((e as Error).message)) });
    } catch (e) {
      toast((e as Error).message);
    }
  });

  const cellProps = (date: string, wd: number, p: PeriodSlot) => ({
    s,
    date,
    wd,
    p,
    rec: byCell.get(`${date}:${p.id}`),
    eff: effectiveSlot(s, date, p.id, overrides),
    today,
    dragProps: handleProps({ date, periodId: p.id }, byCell.get(`${date}:${p.id}`)?.classKey ?? effectiveSlot(s, date, p.id, overrides).classKey ?? ''),
    dropping: !!drag?.over && drag.over.date === date && drag.over.periodId === p.id,
  });

  return (
    <div className={cx('week', editing && 'week--editing')}>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {ws.getMonth() + 1}월 {Math.ceil((ws.getDate() + new Date(ws.getFullYear(), ws.getMonth(), 1).getDay()) / 7)}주
          </h1>
          <p className="page-head__sub">
            {formatMonthDay(weekStart)} – {formatMonthDay(weekEnd)} · 계획 {planned} · 완료 {done}
            {changedCount > 0 && <span className="chip chip--change">이번 주 변경 {changedCount}칸</span>}
          </p>
        </div>
        <div className="page-head__actions">
          <button className={cx('btn btn--sm', editing ? 'btn--primary' : '')} onClick={() => setEditing(!editing)} aria-pressed={editing}>
            {editing ? <Check size={16} /> : <Pencil size={16} />} {editing ? '변경 완료' : '이번 주 시간표 바꾸기'}
          </button>
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

      {editing ? (
        <div className="notice notice--edit">
          <Pencil size={16} />
          <span style={{ flex: 1 }}>
            <b>이 주({formatMonthDay(weekStart)} 주)만</b> 바뀌어요. 칸마다 반을 바꾸거나 ‘— 없음 / 휴강’을 고르세요. 매주 반복되는 시간표는 <a href="#/settings?tab=timetable">설정 → 시간표</a>에서 바꿔요.
          </span>
          {changedCount > 0 && (
            <button
              className="btn btn--sm"
              onClick={async () => {
                if (!(await confirmDialog({ title: '이번 주 변경 모두 되돌리기', message: `이 주에 바꾼 ${changedCount}칸을 정기 시간표대로 되돌릴까요?\n(이미 적어 둔 수업 기록은 그대로 남아요)`, confirmLabel: '되돌리기' }))) return;
                for (const o of overrides.values()) await setSlotOverride(s, o.date, o.periodId, undefined);
                toast('정기 시간표로 되돌렸어요.');
              }}
            >
              <RotateCcw size={14} /> 모두 되돌리기
            </button>
          )}
        </div>
      ) : (
        Object.keys(s.timetable).length === 0 && (
          <div className="notice">
            <PixelIcon kind="bang" size={14} color="var(--pink)" />
            정기 시간표가 비어 있어요. 칸을 눌러 바로 수업을 넣거나, <a href="#/settings?tab=timetable">설정 → 시간표</a>에서 반을 지정하면 매주 자동으로 채워져요.
          </div>
        )
      )}

      {!editing && <p className="week__drag-hint muted">수업 칸을 끌어서(iPad는 길게 눌러서) 다른 칸에 놓으면 이번 주만 옮겨져요. 수업이 있는 칸에 놓으면 서로 바꿔요.</p>}

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
            <PeriodRow key={p.id} p={p} days={days} today={today} editing={editing} cellProps={cellProps} />
          ))}
        </div>
      </div>

      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.label} 옮기는 중…
        </div>
      )}

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
                <li key={p.id} data-slot={`${date}|${p.id}`} className={cx(drag?.over?.date === date && drag.over.periodId === p.id && 'is-drop')}>
                  <div className="day-list__period">
                    <span className="title-font">{p.short}</span>
                    {p.grades && <span className="muted">{p.grades.join('·')}학년</span>}
                  </div>
                  {editing ? <SlotEditor {...cellProps(date, wd, p)} /> : <LessonCell {...cellProps(date, wd, p)} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

interface CellProps {
  s: Settings;
  date: string;
  wd: number;
  p: PeriodSlot;
  rec?: LessonRecord;
  eff: EffectiveSlot;
  today: string;
  dragProps?: ReturnType<ReturnType<typeof useLessonDrag>['handleProps']>;
  dropping?: boolean;
}

function PeriodRow({
  p,
  days,
  today,
  editing,
  cellProps,
}: {
  p: PeriodSlot;
  days: { wd: number; date: string }[];
  today: string;
  editing: boolean;
  cellProps: (date: string, wd: number, p: PeriodSlot) => CellProps;
}) {
  return (
    <>
      <div className="planner__period" role="rowheader">
        <span className="title-font">{p.short}</span>
        {p.grades && <span className="planner__grades">{p.grades.join('·')}학년</span>}
        {p.start && <span className="planner__time">{p.start}</span>}
      </div>
      {days.map(({ wd, date }) => {
        const cp = cellProps(date, wd, p);
        return (
          <div key={date} className={cx('planner__cell', date === today && 'is-today', cp.dropping && 'is-drop')} role="gridcell" data-slot={`${date}|${p.id}`}>
            {editing ? <SlotEditor {...cp} /> : <LessonCell {...cp} />}
          </div>
        );
      })}
    </>
  );
}

/** 편집 모드: 이 날짜 칸의 반을 이번 주만 바꾼다 */
function SlotEditor({ s, date, p, rec, eff }: CellProps) {
  const classes = allClasses(s).filter((c) => periodAllowsGrade(p, c.grade));
  const value = rec?.classKey ?? eff.classKey ?? '';
  const changed = !!eff.override;
  return (
    <div className={cx('slot-editor', changed && 'is-changed', eff.cancelled && 'is-cancelled')}>
      <select
        className="select slot-editor__select"
        value={value}
        aria-label={`${date} ${p.label} 반`}
        onChange={async (e) => {
          const el = e.target;
          if (el.value === '__custom') {
            // 보결 등: 담당 반이 아닌 학급도 직접 입력
            el.value = value;
            const typed = await promptDialog({ title: '학급 직접 입력 (보결 등)', message: `${date} ${p.label}에 들어간 학급을 적어 주세요.\n예) 5-3 또는 5학년 3반`, placeholder: '5-3', confirmLabel: '넣기' });
            if (!typed) return;
            const cls = normalizeClassInput(typed);
            if (!cls) return toast('"5-3" 또는 "5학년 3반"처럼 적어 주세요.');
            const isRoster = classes.some((c) => c.key === cls);
            await changeSlotClass(s, date, p.id, cls, eff.regular, isRoster ? '반 변경' : '보결', isRoster ? 'change' : 'substitute');
            return;
          }
          const next = el.value || null;
          const ok = await changeSlotClass(s, date, p.id, next, eff.regular);
          if (!ok) el.value = value;
        }}
      >
        <option value="">{eff.regular ? '— 휴강 / 없음' : '—'}</option>
        {classes.map((c) => (
          <option key={c.key} value={c.key}>
            {c.key}
            {c.key === eff.regular ? ' (정기)' : ''}
          </option>
        ))}
        {value && !classes.some((c) => c.key === value) && <option value={value}>{value} (보결)</option>}
        <option value="__custom">✎ 직접 입력 (보결 · 다른 학급)</option>
      </select>
      {changed && (
        <button className="slot-editor__reset" onClick={() => void setSlotOverride(s, date, p.id, undefined)} aria-label="이 칸 정기 시간표로 되돌리기" title={`정기: ${eff.regular ?? '없음'}`}>
          <RotateCcw size={12} /> {eff.regular ?? '없음'}
        </button>
      )}
    </div>
  );
}

export function LessonCell({ date, p, rec, eff, today, dragProps }: CellProps) {
  const cls = rec?.classKey ?? eff.classKey;
  const open = () => openLesson(rec ? { recordId: rec.id } : { date, periodId: p.id });
  const changed = !!eff.override && !eff.cancelled;
  if (!cls) {
    if (eff.cancelled) {
      return (
        <button className="lesson-cell lesson-cell--cancelled" onClick={open} aria-label={`${date} ${p.label} 휴강 (원래 ${eff.regular})`}>
          <span className="lesson-cell__class title-font">휴강</span>
          <span className="lesson-cell__hint">원래 {eff.regular}</span>
          {eff.override?.note && <span className="lesson-cell__memo">{eff.override.note}</span>}
        </button>
      );
    }
    return (
      <button className="lesson-cell lesson-cell--empty" onClick={open} aria-label={`${date} ${p.label} 수업 추가`}>
        <Plus size={16} />
      </button>
    );
  }
  const past = date < today;
  return (
    <div
      className={cx('lesson-cell', rec?.completed && 'is-done', !rec?.lesson && 'is-unplanned', past && !rec?.completed && rec?.lesson && 'is-missed', changed && 'is-changed', !rec?.completed && 'is-draggable')}
      data-grade={cls.split('-')[0]}
      {...(rec?.completed ? {} : dragProps)}
    >
      <button className="lesson-cell__main" onClick={open}>
        <span className="lesson-cell__class title-font">
          {cls}
          {changed && <span className="lesson-cell__badge">{eff.override?.kind === 'substitute' ? '보결' : eff.override?.kind === 'move' ? '이동' : '변경'}</span>}
        </span>
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

export type { OverrideMap };
