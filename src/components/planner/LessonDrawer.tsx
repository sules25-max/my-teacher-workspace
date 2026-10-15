import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check as CheckIcon, Copy, Pencil, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { changeSlotClass } from './slotChange';
import { db } from '../../services/localDb';
import * as repo from '../../services/repo';
import { useSettings } from '../../hooks/useData';
import { useRoute } from '../../hooks/useRoute';
import { closeLesson, useLessonTarget, type LessonTarget } from './lessonDrawerStore';
import { Drawer, Modal, confirmDialog, toast } from '../common/overlays';
import { AutoInput, AutoTextarea, Checklist } from '../common/fields';
import { AttachmentBar } from '../common/Attachments';
import {
  applySuggestion,
  classLabel,
  classesOfGrade,
  copyLesson,
  createLessonRecord,
  curriculumFor,
  listCopySlots,
  type CopyTarget,
  periodLabel,
  setLessonCompleted,
  suggestNextFor,
  allClasses,
  periodAllowsGrade,
  inAcademicYear,
  effectiveSlot,
  setSlotOverride,
  type EffectiveSlot,
  type Suggestion,
} from '../../services/planner';
import type { LessonRecord, Settings } from '../../types';
import { WEEKDAY_KO, formatShort, isoWeekday } from '../../utils/date';
import { ACTIVITY_PRESETS, MATERIAL_PRESETS } from '../../data/defaults';
import { cx, parseClassKey } from '../../utils/id';
import { PixelIcon } from '../common/Deco';

export function LessonDrawerHost() {
  const target = useLessonTarget();
  const route = useRoute();
  // 다른 화면으로 이동하면 수업 카드를 닫는다
  useEffect(() => closeLesson(), [route.name]);
  return (
    <Drawer
      open={!!target}
      onClose={closeLesson}
      label="수업 카드"
      title={<span className="title-font">LESSON CARD</span>}
    >
      {target && <LessonCard target={target} key={JSON.stringify(target)} />}
    </Drawer>
  );
}

function useRecord(target: LessonTarget) {
  return useLiveQuery(async () => {
    if ('recordId' in target) return (await db.lessons.get(target.recordId)) ?? null;
    return (await db.lessons.where('[date+periodId]').equals([target.date, target.periodId]).first()) ?? null;
  }, [JSON.stringify(target)]);
}

function LessonCard({ target }: { target: LessonTarget }) {
  const s = useSettings();
  const record = useRecord(target);
  const slot = 'recordId' in target ? null : target;
  const date = record?.date ?? slot?.date ?? '';
  const periodId = record?.periodId ?? slot?.periodId ?? '';
  const override = useLiveQuery(async () => (date ? ((await db.slotOverrides.where('[date+periodId]').equals([date, periodId]).first()) ?? null) : null), [date, periodId]);
  // 정기 시간표 + 이번 주 변경을 합친 이 칸의 반
  const eff = date ? effectiveSlot(s, date, periodId, override ? new Map([[`${date}:${periodId}`, override]]) : undefined) : undefined;
  const [pickedClass, setPickedClass] = useState<string | undefined>();
  // 설정은 비동기로 로드되므로 시간표 반은 state에 굳히지 않고 매번 계산한다
  const cls = record?.classKey ?? pickedClass ?? slot?.classKey ?? eff?.classKey;

  const creating = useRef<Promise<LessonRecord> | null>(null);
  const ensure = async (): Promise<LessonRecord> => {
    if (record) return record;
    if (!cls) throw new Error('반을 먼저 골라 주세요.');
    creating.current ??= createLessonRecord(s, date, periodId, cls);
    return creating.current;
  };
  const patch = async (changes: Partial<LessonRecord>) => {
    const r = await ensure();
    await repo.update<LessonRecord>('lessons', r.id, changes);
  };

  if (record === undefined || override === undefined) return null;

  if (!cls) {
    return (
      <div className="stack">
        {eff?.cancelled && (
          <div className="notice notice--edit">
            <span style={{ flex: 1 }}>
              <b>이번 주 휴강</b> (원래 {eff.regular}){eff.override?.note ? ` · ${eff.override.note}` : ''}
            </span>
            <button className="btn btn--sm" onClick={() => void setSlotOverride(s, date, periodId, undefined)}>
              원래대로
            </button>
          </div>
        )}
        <ClassPicker s={s} periodId={periodId} date={date} onPick={setPickedClass} />
      </div>
    );
  }

  const { grade } = parseClassKey(cls);
  return (
    <div className="lesson-card">
      <header className="lesson-card__head">
        <div>
          <h2 className="lesson-card__class">{classLabel(cls)}</h2>
          <p className="muted">
            {formatShort(date)} · {periodLabel(s, periodId)}
          </p>
        </div>
        <CompleteButton s={s} record={record} onCreateNeeded={ensure} />
      </header>

      <SlotChangeSection s={s} date={date} periodId={periodId} cls={cls} eff={eff} onPicked={setPickedClass} />

      <LessonPicker s={s} grade={grade} record={record} cls={cls} date={date} periodId={periodId} patch={patch} />

      <section className="lesson-card__section">
        <h3 className="section-title">오늘의 목표</h3>
        <AutoInput
          saveKey={`${record?.id ?? 'new'}:objective`}
          value={record?.objective ?? ''}
          onSave={(v) => patch({ objective: v })}
          placeholder="예) What time is it?"
        />
      </section>

      <section className="lesson-card__section">
        <h3 className="section-title">활동</h3>
        <Checklist items={record?.activities ?? []} onChange={(activities) => patch({ activities })} presets={ACTIVITY_PRESETS} placeholder="활동 추가" />
      </section>

      <section className="lesson-card__section">
        <h3 className="section-title">
          수업 메모 <span className="chip">이 반에만 저장</span>
        </h3>
        <AutoTextarea
          saveKey={`${record?.id ?? 'new'}:memo`}
          value={record?.memo ?? ''}
          onSave={(v) => patch({ memo: v })}
          lined
          rows={5}
          placeholder="예) speaking 활동 시간이 조금 부족했음."
        />
      </section>

      <section className="lesson-card__section">
        <h3 className="section-title">준비물</h3>
        <Checklist items={record?.materials ?? []} onChange={(materials) => patch({ materials })} presets={MATERIAL_PRESETS} placeholder="준비물 추가" />
      </section>

      <section className="lesson-card__section">
        <h3 className="section-title">첨부</h3>
        <AttachmentBar
          ids={record?.attachments ?? []}
          owner={{ type: 'lesson', id: record?.id ?? 'pending' }}
          onChange={async (attachments) => patch({ attachments })}
        />
      </section>

      {record?.lesson && <CopySection s={s} record={record} />}

      {record && (
        <div className="lesson-card__danger">
          <button
            className="btn btn--ghost btn--sm"
            onClick={async () => {
              if (
                await confirmDialog({
                  title: '수업 기록 삭제',
                  message: `${classLabel(record.classKey)} ${formatShort(record.date)} 수업 기록을 삭제할까요?\n진도표에 반영된 차시도 함께 지워져요.`,
                  confirmLabel: '삭제',
                  danger: true,
                })
              ) {
                if (record.completed) await setLessonCompleted(record, false);
                await repo.remove('lessons', record.id);
                closeLesson();
                toast('수업 기록을 삭제했어요.');
              }
            }}
          >
            <Trash2 size={16} /> 이 수업 기록 삭제
          </button>
        </div>
      )}
    </div>
  );
}

function ClassPicker({ s, periodId, date, onPick }: { s: Settings; periodId: string; date: string; onPick: (k: string) => void }) {
  const period = s.periods.find((p) => p.id === periodId);
  const classes = allClasses(s).filter((c) => !period || periodAllowsGrade(period, c.grade));
  return (
    <div className="stack">
      <h2 className="title-font">
        {formatShort(date)} · {period?.label}
      </h2>
      <p className="muted">어느 반 수업인가요? 정기 시간표는 설정 → 시간표에서 지정할 수 있어요.</p>
      <div className="class-grid">
        {classes.map((c) => (
          <button key={c.key} className="btn btn--title" onClick={() => onPick(c.key)}>
            {c.key}
          </button>
        ))}
      </div>
    </div>
  );
}

function CompleteButton({ s, record, onCreateNeeded }: { s: Settings; record: LessonRecord | null; onCreateNeeded: () => Promise<LessonRecord> }) {
  const done = !!record?.completed;
  return (
    <button
      className={cx('complete-btn', done && 'is-done')}
      aria-pressed={done}
      onClick={async () => {
        const r = record ?? (await onCreateNeeded());
        if (!r.lesson && !done) {
          toast('Lesson과 차시를 먼저 정하면 진도표에도 반영돼요.');
        }
        const { progressChanged } = await setLessonCompleted(r, !done);
        if (!done && progressChanged) {
          const count = (await db.progress.where('classKey').equals(r.classKey).toArray()).filter((e) => inAcademicYear(s, e.date)).length;
          toast(`${r.classKey} 진도 ${count}차시로 반영했어요.`, { label: '되돌리기', run: () => void setLessonCompleted({ ...r, completed: true }, false) });
        }
      }}
    >
      <span className="complete-btn__box">{done && <CheckIcon size={20} strokeWidth={3} />}</span>
      {done ? '수업 완료' : '완료하기'}
    </button>
  );
}

function LessonPicker({
  s,
  grade,
  record,
  cls,
  date,
  periodId,
  patch,
}: {
  s: Settings;
  grade: number;
  record: LessonRecord | null;
  cls: string;
  date: string;
  periodId: string;
  patch: (c: Partial<LessonRecord>) => Promise<void>;
}) {
  const curr = curriculumFor(s, grade);
  const [sug, setSug] = useState<Suggestion | null>(null);
  useEffect(() => {
    let alive = true;
    suggestNextFor(s, cls, date, periodId).then((x) => alive && setSug(x));
    return () => {
      alive = false;
    };
  }, [s, cls, date, periodId, record?.updatedAt]);
  const lesson = curr.find((l) => l.id === record?.lessonId);
  const isSuggested = sug && record?.lessonId === sug.lessonId && record?.session === sug.session;

  return (
    <section className="lesson-card__lesson">
      {sug && !isSuggested && !record?.completed && (
        <div className="suggest">
          <Sparkles size={18} color="var(--orange)" />
          <span>
            다음 차시 <b>{sug.lesson} / {sug.session}차시</b>
          </span>
          <button className="btn btn--sm" onClick={() => patch(applySuggestion(sug))}>
            적용
          </button>
        </div>
      )}
      <div className="lesson-picker">
        <label className="field">
          <span className="field__label">Lesson</span>
          <select
            className="select"
            value={record?.lessonId ?? ''}
            onChange={(e) => {
              const l = curr.find((x) => x.id === e.target.value);
              if (!l) return void patch({ lessonId: undefined, lesson: '', session: 0 });
              void patch({ lessonId: l.id, lesson: l.name, totalSessions: l.sessions, session: Math.min(record?.session || 1, l.sessions) || 1 });
            }}
          >
            <option value="">선택</option>
            {curr.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.title ? ` · ${l.title}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span className="field__label">차시</span>
          <div className="session-pick" role="group" aria-label="차시 선택">
            {Array.from({ length: lesson?.sessions ?? 4 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                className={cx('session-pick__btn', record?.session === n && 'is-active')}
                aria-pressed={record?.session === n}
                disabled={!lesson}
                onClick={() => patch({ session: n })}
              >
                {n}
              </button>
            ))}
            {lesson && <span className="muted session-pick__of">/ {lesson.sessions}차시</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function CopySection({ s, record }: { s: Settings; record: LessonRecord }) {
  const others = useMemo(() => classesOfGrade(s, record.grade).filter((c) => c.key !== record.classKey), [s, record.grade, record.classKey]);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ key: string; slots: CopyTarget[]; chosen: number; recommended: number } | null>(null);
  const copied = useLiveQuery(() => db.lessons.where('classKey').anyOf(others.map((o) => o.key)).filter((r) => r.copiedFrom === record.id).toArray(), [record.id, others.length]);
  if (!others.length) return null;

  const doCopy = async (t: CopyTarget) => {
    if (t.willOverwrite) {
      const ok = await confirmDialog({
        title: `${t.classKey}에 복사`,
        message: `${t.slotLabel} 칸에 이미 "${t.existing?.lesson} ${t.existing?.session}차시"가 있어요.\n수업 내용만 바꾸고 ${t.classKey}의 메모와 첨부는 그대로 둘까요?`,
        confirmLabel: '바꾸기',
      });
      if (!ok) return false;
    }
    await copyLesson(s, record, t);
    return true;
  };

  /** ask=true면 이번 주에 그 반 수업이 2번 이상일 때 어느 칸에 넣을지 고르게 한다 */
  const run = async (key: string, ask: boolean) => {
    setBusy(key);
    try {
      const { slots, recommended } = await listCopySlots(s, record, key);
      if (!slots.length) {
        toast(`이번 주 시간표에 ${key} 수업이 없어요. 설정 → 시간표에서 지정해 주세요.`);
        return null;
      }
      if (ask && slots.length > 1) {
        setPicker({ key, slots, chosen: recommended, recommended });
        return null;
      }
      const t = slots[recommended];
      return (await doCopy(t)) ? t : null;
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="lesson-card__section copy-box">
      <h3 className="section-title">
        <Copy size={18} /> 다른 반으로 복사
      </h3>
      <p className="muted copy-box__hint">Lesson · 차시 · 목표 · 활동 · 준비물만 복사돼요. 메모는 반마다 따로 써요.</p>
      <div className="row row--wrap">
        {others.map((o) => {
          const done = copied?.find((c) => c.classKey === o.key);
          return (
            <button
              key={o.key}
              className={cx('btn btn--sm btn--title', done && 'is-copied')}
              disabled={busy === o.key}
              onClick={async () => {
                const t = await run(o.key, true);
                if (t) toast(`${o.key} ${t.slotLabel}에 복사했어요.`);
              }}
              title={done ? `${WEEKDAY_KO[isoWeekday(done.date)]} ${periodLabel(s, done.periodId)}에 복사됨` : undefined}
            >
              {done ? <PixelIcon kind="star" size={12} color="var(--orange)" /> : null}
              {o.key}에 복사
            </button>
          );
        })}
        {others.length > 1 && (
          <button
            className="btn btn--sm btn--primary"
            disabled={!!busy}
            onClick={async () => {
              const done: string[] = [];
              for (const o of others) {
                const t = await run(o.key, false);
                if (t) done.push(`${o.key} ${t.slotLabel}`);
              }
              if (done.length) toast(`복사했어요: ${done.join(', ')}`, undefined, 6000);
            }}
          >
            모든 반에 복사
          </button>
        )}
      </div>

      <Modal
        open={!!picker}
        onClose={() => setPicker(null)}
        title={`${picker?.key ?? ''} · 어느 수업에 넣을까요?`}
        label="복사할 칸 선택"
        footer={
          <>
            <button className="btn" onClick={() => setPicker(null)}>
              취소
            </button>
            <button
              className="btn btn--primary"
              onClick={async () => {
                if (!picker) return;
                const t = picker.slots[picker.chosen];
                setPicker(null);
                if (await doCopy(t)) toast(`${t.classKey} ${t.slotLabel}에 복사했어요.`);
              }}
            >
              복사
            </button>
          </>
        }
      >
        {picker && (
          <div className="slot-pick" role="radiogroup" aria-label="복사할 칸">
            <p className="muted">이번 주에 {picker.key} 수업이 {picker.slots.length}번 있어요.</p>
            {picker.slots.map((sl, i) => (
              <button
                key={`${sl.date}:${sl.periodId}`}
                role="radio"
                aria-checked={picker.chosen === i}
                className={cx('slot-pick__item', picker.chosen === i && 'is-active')}
                onClick={() => setPicker({ ...picker, chosen: i })}
              >
                <span className="slot-pick__radio" aria-hidden="true" />
                <span className="slot-pick__label title-font">
                  {sl.slotLabel} <span className="muted slot-pick__date">{formatShort(sl.date!)}</span>
                </span>
                <span className="slot-pick__state">
                  {sl.existing?.lesson ? `${sl.existing.lesson} ${sl.existing.session}차시${sl.existing.completed ? ' · 완료' : ''}` : '비어 있음'}
                </span>
                {i === picker.recommended && <span className="chip chip--done">추천</span>}
              </button>
            ))}
          </div>
        )}
      </Modal>
    </section>
  );
}

/** 이 날짜 칸만 반을 바꾸거나 휴강으로 (정기 시간표는 그대로) */
function SlotChangeSection({
  s,
  date,
  periodId,
  cls,
  eff,
  onPicked,
}: {
  s: Settings;
  date: string;
  periodId: string;
  cls: string;
  eff?: EffectiveSlot;
  onPicked: (k: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(eff?.override?.note ?? '');
  const period = s.periods.find((p) => p.id === periodId);
  const classes = allClasses(s).filter((c) => !period || periodAllowsGrade(period, c.grade));
  const changed = !!eff?.override;
  return (
    <section className={cx('slot-change', changed && 'is-changed')}>
      <button className="slot-change__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Pencil size={14} />
        {changed ? (
          <span>
            이번 주 변경됨 · 원래 <b>{eff?.regular ?? '수업 없음'}</b>
          </span>
        ) : (
          <span>이번 주만 반 바꾸기 · 휴강</span>
        )}
      </button>
      {open && (
        <div className="slot-change__body">
          <div className="row row--wrap">
            {classes.map((c) => (
              <button
                key={c.key}
                className={cx('chip slot-change__chip', c.key === cls && 'chip--done')}
                aria-pressed={c.key === cls}
                onClick={async () => {
                  if (c.key === cls) return;
                  if (await changeSlotClass(s, date, periodId, c.key, eff?.regular, note || undefined)) {
                    onPicked(c.key);
                    toast(`${formatShort(date)} ${periodLabel(s, periodId)}을(를) ${c.key}(으)로 바꿨어요. (이번 주만)`);
                  }
                }}
              >
                {c.key}
                {c.key === eff?.regular ? ' · 정기' : ''}
              </button>
            ))}
          </div>
          <div className="row">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="사유 (선택) 예) 학예회 연습, 교환 수업" aria-label="변경 사유" />
          </div>
          <div className="row row--wrap">
            <button
              className="btn btn--sm btn--pink"
              onClick={async () => {
                if (await changeSlotClass(s, date, periodId, null, eff?.regular, note || undefined)) {
                  onPicked(undefined);
                  toast('이번 주 이 칸을 휴강으로 바꿨어요.');
                }
              }}
            >
              이번 주 휴강
            </button>
            {changed && (
              <button
                className="btn btn--sm"
                onClick={async () => {
                  if (eff?.regular && eff.regular !== cls) {
                    if (!(await changeSlotClass(s, date, periodId, eff.regular, eff.regular))) return;
                  } else await setSlotOverride(s, date, periodId, undefined);
                  onPicked(undefined);
                  toast('정기 시간표대로 되돌렸어요.');
                }}
              >
                <RotateCcw size={14} /> 원래대로 ({eff?.regular ?? '없음'})
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
