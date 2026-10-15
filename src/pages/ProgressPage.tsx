import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/localDb';
import { useSettings } from '../hooks/useData';
import { classesOfGrade, computeClassProgress, curriculumFor, lessonStatus, toggleProgressCell, setLessonCompleted, markProgressUpTo } from '../services/planner';
import type { CurriculumLesson, ProgressEntry } from '../types';
import { cx } from '../utils/id';
import { todayISO, formatShort } from '../utils/date';
import { Modal, confirmDialog, toast } from '../components/common/overlays';
import { PixelIcon } from '../components/common/Deco';
import { AssistantAvatar } from '../components/assistant/AssistantAvatar';

export function ProgressPage() {
  const s = useSettings();
  const entries = useLiveQuery(() => db.progress.toArray(), []) ?? [];
  const unsynced = useLiveQuery(async () => {
    const done = await db.lessons.filter((l) => l.completed && !!l.lessonId && l.session > 0).toArray();
    const keys = new Set((await db.progress.toArray()).map((e) => `${e.classKey}:${e.lessonId}:${e.session}`));
    return done.filter((l) => !keys.has(`${l.classKey}:${l.lessonId}:${l.session}`));
  }, []);
  const [grade, setGrade] = useState<number>(s.grades[0] ?? 3);
  const g = s.grades.includes(grade) ? grade : (s.grades[0] ?? 3);
  const classes = classesOfGrade(s, g);
  const progress = classes.map((c) => computeClassProgress(s, c, entries));
  const lead = Math.max(0, ...progress.map((p) => p.done));
  const curr = curriculumFor(s, g);
  const [cell, setCell] = useState<{ cls: string; lesson: CurriculumLesson } | null>(null);

  return (
    <div className="progress-page">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">{s.totalSessions}차시 진도표</h1>
          <p className="page-head__sub">수업 카드에서 ‘완료’를 누르면 자동으로 채워져요.</p>
        </div>
        <div className="page-head__actions">
          <div className="seg" role="tablist" aria-label="학년">
            {s.grades.map((gr) => (
              <button key={gr} role="tab" aria-selected={gr === g} aria-pressed={gr === g} onClick={() => setGrade(gr)}>
                {gr}학년
              </button>
            ))}
          </div>
        </div>
      </div>

      {!!unsynced?.length && (
        <div className="notice">
          <AssistantAvatar expression="surprised" size={36} />
          <span style={{ flex: 1 }}>
            완료 표시는 됐는데 진도표에 빠진 수업이 {unsynced.length}개 있어. ({unsynced.slice(0, 3).map((u) => `${u.classKey} ${u.lesson} ${u.session}차시`).join(', ')}
            {unsynced.length > 3 ? ' …' : ''})
          </span>
          <button
            className="btn btn--sm btn--primary"
            onClick={async () => {
              if (!(await confirmDialog({ title: '진도표에 반영할까요?', message: unsynced.map((u) => `${u.classKey} · ${u.lesson} ${u.session}차시 (${formatShort(u.date)})`).join('\n'), confirmLabel: '반영' }))) return;
              for (const u of unsynced) await setLessonCompleted({ ...u, completed: false }, true);
              toast('진도표에 반영했어요.');
            }}
          >
            반영
          </button>
        </div>
      )}

      <section className="card progress-bars">
        <div className="card__head">
          <h2 className="card__title">
            <PixelIcon kind="star" size={14} color="var(--orange)" /> {g}학년
          </h2>
        </div>
        <div className="card__body">
          {classes.length === 0 ? (
            <p className="muted">설정에서 {g}학년 반 수를 정해 주세요.</p>
          ) : (
            <ul className="list-reset progress-list">
              {progress.map((p) => {
                const behind = lead - p.done;
                return (
                  <li key={p.key} className={cx('progress-row', behind >= 2 && 'is-behind')}>
                    <span className="progress-row__class title-font">{p.key}</span>
                    <div className={cx('bar', behind >= 2 && 'bar--behind')} role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-label={`${p.key} 진도`}>
                      <div className="bar__fill" style={{ transform: `scaleX(${Math.min(1, p.done / Math.max(1, p.total))})` }} />
                    </div>
                    <span className="progress-row__count">
                      <b>{p.done}</b> / {p.total}
                    </span>
                    <span className="progress-row__next">
                      {behind >= 1 && <span className={cx('chip', behind >= 2 && 'chip--warn')}>{behind}차시 느림</span>}
                      {p.next && <span className="muted">다음 {p.next.lesson} {p.next.session}차시</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="card progress-matrix-card">
        <div className="card__head">
          <h2 className="card__title">Lesson별 세부표</h2>
          <span className="legend muted">
            <span className="dot dot--done" /> 완료 <span className="dot dot--partial" /> 진행 중 <span className="dot dot--none" /> 시작 전
          </span>
        </div>
        <div className="card__body matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th scope="col">Lesson</th>
                {classes.map((c) => (
                  <th scope="col" key={c.key} className="title-font">
                    {c.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {curr.map((l) => (
                <tr key={l.id}>
                  <th scope="row">
                    <span className="title-font">{l.name}</span>
                    {l.title && <span className="matrix__sub">{l.title}</span>}
                  </th>
                  {classes.map((c) => {
                    const st = lessonStatus(l, c.key, entries, s);
                    return (
                      <td key={c.key}>
                        <button className={cx('matrix__cell', `is-${st.status}`)} onClick={() => setCell({ cls: c.key, lesson: l })} aria-label={`${c.key} ${l.name} ${st.count}/${l.sessions}차시`}>
                          <span className="matrix__dot" aria-hidden="true" />
                          <span className="matrix__count">
                            {st.count}/{l.sessions}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SessionEditor cell={cell} onClose={() => setCell(null)} entries={entries} />
    </div>
  );
}

function SessionEditor({ cell, onClose, entries }: { cell: { cls: string; lesson: CurriculumLesson } | null; onClose: () => void; entries: ProgressEntry[] }) {
  const s = useSettings();
  const [upTo, setUpTo] = useState(1);
  const done = useMemo(() => {
    if (!cell) return new Map<number, ProgressEntry>();
    return new Map(entries.filter((e) => e.classKey === cell.cls && e.lessonId === cell.lesson.id).map((e) => [e.session, e]));
  }, [cell, entries]);
  if (!cell) return null;
  return (
    <Modal open onClose={onClose} title={`${cell.cls} · ${cell.lesson.name}`} label="차시 편집">
      <p className="muted" style={{ marginBottom: 12 }}>
        차시를 눌러 직접 표시하거나 지울 수 있어요.
      </p>
      <div className="session-grid">
        {Array.from({ length: cell.lesson.sessions }, (_, i) => i + 1).map((n) => {
          const e = done.get(n);
          return (
            <button
              key={n}
              className={cx('session-grid__btn', e && 'is-done')}
              aria-pressed={!!e}
              onClick={async () => {
                if (e?.source === 'lesson') {
                  const ok = await confirmDialog({ title: '진도 기록 지우기', message: `수업 카드에서 완료한 ${n}차시 기록이에요. 진도표에서만 지울까요?`, confirmLabel: '지우기', danger: true });
                  if (!ok) return;
                }
                await toggleProgressCell(s, cell.cls, cell.lesson, n, todayISO());
              }}
            >
              <span className="title-font">{n}차시</span>
              <span className="muted">{e ? formatShort(e.date) : '—'}</span>
            </button>
          );
        })}
      </div>
      <div className="row row--wrap progress-upto">
        <span className="muted">학기 중간에 시작했다면</span>
        <select className="select progress-upto__select" value={upTo} onChange={(e) => setUpTo(Number(e.target.value))} aria-label="몇 차시까지">
          {Array.from({ length: cell.lesson.sessions }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {cell.lesson.name} {n}차시
            </option>
          ))}
        </select>
        <button
          className="btn btn--sm"
          onClick={async () => {
            const ok = await confirmDialog({
              title: '앞 차시 모두 완료로 표시',
              message: `${cell.cls}의 첫 차시부터 ${cell.lesson.name} ${upTo}차시까지 빠진 차시를 모두 완료로 기록할까요?`,
              confirmLabel: '표시하기',
            });
            if (!ok) return;
            const n = await markProgressUpTo(s, cell.cls, cell.lesson.id, upTo, todayISO());
            toast(n ? `${n}개 차시를 완료로 표시했어요.` : '이미 모두 표시되어 있어요.');
          }}
        >
          까지 모두 완료
        </button>
      </div>
    </Modal>
  );
}
