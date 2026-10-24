import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/localDb';
import { useSettings } from '../../hooks/useData';
import type { PreparedImage, VisionResult } from '../../services/ai/vision';
import { saveBoard, saveEvents, saveInbox, saveMeeting, saveTodos, saveToLesson, todayLessonTargets, type LessonTargetOption } from '../../services/ai/visionSave';
import { similar } from '../../services/ai/daily';
import { toast } from '../common/overlays';
import { cx } from '../../utils/id';
import { navigate } from '../../hooks/useRoute';
import { react } from '../agent/agentStore';

type Action = 'todo' | 'event' | 'lesson' | 'meeting' | 'board' | 'inbox';

const LABEL: Record<Action, string> = {
  todo: 'Todo에 추가',
  event: '일정으로 추가',
  lesson: '수업 기록으로 저장',
  meeting: '회의 기록으로 저장',
  board: '프리보드에 저장',
  inbox: 'AI Inbox에 저장',
};

/** 이미지 분석 결과 아래의 저장 액션. 미리보기를 보여주고 [저장]을 눌러야만 저장한다. */
export function VisionActions({ v, images, question }: { v: VisionResult; images: PreparedImage[]; question: string }) {
  const s = useSettings();
  const [open, setOpen] = useState<Action | null>(null);
  const [done, setDone] = useState<Set<Action>>(new Set());
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) ?? [];
  const [pickTodo, setPickTodo] = useState<Set<number>>(new Set());
  const [pickEvent, setPickEvent] = useState<Set<number>>(new Set(v.extract.events.map((_, i) => i)));
  const [targets, setTargets] = useState<LessonTargetOption[]>([]);
  const [target, setTarget] = useState('');
  const [title, setTitle] = useState(question.slice(0, 40) || '이미지에서 가져온 자료');
  const [text, setText] = useState(v.extract.summary || v.text);
  const [busy, setBusy] = useState(false);

  // 준비물도 할 일 후보로
  const todoItems = [...v.extract.todos, ...v.extract.materials.map((m) => ({ title: `준비물 챙기기: ${m}`, due: null }))];
  const existingOf = (t: string) => tasks.find((x) => similar(x.title, t));

  useEffect(() => {
    if (open === 'lesson') todayLessonTargets(s).then((t) => (setTargets(t), setTarget(t[0]?.key ?? '')));
  }, [open, s]);
  useEffect(() => setPickTodo(new Set(todoItems.map((_, i) => i).filter((i) => !existingOf(todoItems[i].title)))), [tasks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const available: Action[] = [...(todoItems.length ? (['todo'] as Action[]) : []), ...(v.extract.events.length ? (['event'] as Action[]) : []), 'lesson', 'meeting', 'board', 'inbox'];

  const save = async () => {
    if (!open) return;
    setBusy(true);
    try {
      if (open === 'todo') await saveTodos([...pickTodo].map((i) => todoItems[i]), '이미지 분석');
      if (open === 'event') await saveEvents([...pickEvent].map((i) => v.extract.events[i]), `이미지에서 가져옴: ${question}`);
      if (open === 'lesson') {
        const t = targets.find((x) => x.key === target);
        if (!t) throw new Error('저장할 수업을 골라 주세요.');
        await saveToLesson(s, t, text);
      }
      if (open === 'meeting') navigateLater(`work/${await saveMeeting({ ...v, text }, images, title)}`);
      if (open === 'board') navigateLater(`board/${await saveBoard(images, title)}`);
      if (open === 'inbox') await saveInbox({ ...v, text }, images, title);
      setDone(new Set(done).add(open));
      toast(`${LABEL[open]} 완료`);
      react('done');
      setOpen(null);
    } catch (e) {
      toast(`저장하지 못했어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const [goTo, setGoTo] = useState<string | null>(null);
  const navigateLater = (href: string) => setGoTo(href);

  return (
    <div className="vision-actions">
      <div className="row row--wrap">
        {available.map((a) => (
          <button key={a} className={cx('chip vision-actions__btn', open === a && 'chip--done')} onClick={() => setOpen(open === a ? null : a)} aria-expanded={open === a}>
            {done.has(a) ? '✓ ' : ''}
            {LABEL[a]}
          </button>
        ))}
      </div>

      {open && (
        <div className="vision-preview">
          <p className="vision-preview__title title-font">저장될 내용 미리보기 · {LABEL[open]}</p>

          {open === 'todo' && (
            <ul className="list-reset">
              {todoItems.map((t, i) => {
                const ex = existingOf(t.title);
                return (
                  <li key={i}>
                    <label className={cx('check', ex && 'check--done')}>
                      <input type="checkbox" className="checkbox" disabled={!!ex} checked={pickTodo.has(i)} onChange={(e) => setPickTodo(toggle(pickTodo, i, e.target.checked))} />
                      <span className="check__text">
                        {t.title}
                        {t.due ? ` · 마감 ${t.due}` : ''}
                        {ex && <span className="muted"> · 이미 Todo에 있음</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {open === 'event' && (
            <ul className="list-reset">
              {v.extract.events.map((e, i) => (
                <li key={i}>
                  <label className="check">
                    <input type="checkbox" className="checkbox" checked={pickEvent.has(i)} onChange={(ev) => setPickEvent(toggle(pickEvent, i, ev.target.checked))} />
                    <span className="check__text">
                      {e.date ?? '날짜 미확인(오늘로 저장)'} {e.time ?? ''} · {e.title}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {open === 'lesson' &&
            (targets.length ? (
              <label className="field">
                <span className="field__label">오늘 어느 수업 메모에 덧붙일까요? (기존 메모는 그대로)</span>
                <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {targets.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="muted">오늘 시간표에 수업이 없어요. 주간 계획에서 수업 칸을 먼저 만들어 주세요.</p>
            ))}

          {(open === 'meeting' || open === 'board' || open === 'inbox') && (
            <label className="field">
              <span className="field__label">제목</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          )}
          {(open === 'lesson' || open === 'meeting' || open === 'inbox') && (
            <label className="field">
              <span className="field__label">저장할 글 (고칠 수 있어요)</span>
              <textarea className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
          )}
          {(open === 'meeting' || open === 'board' || open === 'inbox') && <p className="muted vision-preview__note">원본 이미지 {images.length}장도 함께 첨부로 저장돼요.</p>}

          <div className="row">
            <button
              className="btn btn--sm btn--primary"
              disabled={busy || (open === 'todo' && !pickTodo.size) || (open === 'event' && !pickEvent.size) || (open === 'lesson' && !targets.length)}
              onClick={save}
            >
              {busy ? '저장 중…' : '저장'}
            </button>
            <button className="btn btn--sm" onClick={() => setOpen(null)}>
              취소
            </button>
          </div>
        </div>
      )}
      {goTo && (
        <button className="chip" onClick={() => navigate(goTo)}>
          저장한 곳 열기 →
        </button>
      )}
    </div>
  );
}

function toggle(set: Set<number>, i: number, on: boolean) {
  const n = new Set(set);
  if (on) n.add(i);
  else n.delete(i);
  return n;
}
