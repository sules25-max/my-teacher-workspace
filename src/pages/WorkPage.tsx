import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, ArrowLeft, ListChecks, PenLine, Plus, Send, Trash2 } from 'lucide-react';
import { db } from '../services/localDb';
import * as repo from '../services/repo';
import { navigate, useRoute } from '../hooks/useRoute';
import type { MeetingKind, MeetingNote, Task } from '../types';
import { formatEn, formatShort, relativeDue, todayISO } from '../utils/date';
import { cx } from '../utils/id';
import { AutoInput, AutoTextarea } from '../components/common/fields';
import { AttachmentBar } from '../components/common/Attachments';
import { EmptyState } from '../components/common/EmptyState';
import { Modal, confirmDialog, toast } from '../components/common/overlays';
import { InkCanvas } from '../components/canvas/InkCanvas';
import { createInkDoc } from '../services/attachments';
import { addTask, parseTaskText } from '../services/tasks';
import { PixelIcon } from '../components/common/Deco';
import { useMediaQuery } from '../hooks/useMediaQuery';

const KINDS: MeetingKind[] = ['부장회의', '교직원회의', '업무회의', '학년회의', '기타'];

export async function createMeeting(kind: MeetingKind = '부장회의', date = todayISO()) {
  return repo.create<MeetingNote>('meetings', { title: kind, kind, date, announcements: '', decisions: '', todos: '', memo: '', attachments: [] });
}

export function WorkPage() {
  const route = useRoute();
  const id = route.params[0];
  const wide = useMediaQuery('(min-width: 900px)');
  const meetings = useLiveQuery(() => db.meetings.orderBy('date').reverse().filter((m) => !m.archived).toArray(), []) ?? [];

  const list = (
    <aside className="work__list">
      <div className="row row--between work__list-head">
        <h1 className="page-head__title">회의 · 업무</h1>
      </div>
      <div className="row row--wrap work__new">
        {KINDS.slice(0, 3).map((k) => (
          <button
            key={k}
            className={cx('btn btn--sm', k === '부장회의' && 'btn--primary')}
            onClick={async () => {
              const m = await createMeeting(k);
              navigate(`work/${m.id}`);
            }}
          >
            <Plus size={16} /> {k}
          </button>
        ))}
      </div>
      {meetings.length === 0 ? (
        <EmptyState text="아직 회의 메모가 없어. 회의 들어가면 바로 하나 만들어 봐!" expression="thinking" />
      ) : (
        <ul className="list-reset memo-sheet-list">
          {meetings.map((m) => (
            <li key={m.id}>
              <a href={`#/work/${m.id}`} className={cx('memo-sheet-item', m.id === id && 'is-active')} aria-current={m.id === id ? 'page' : undefined}>
                <span className="memo-sheet-item__date">{formatShort(m.date)}</span>
                <span className="memo-sheet-item__title title-font">{m.title || m.kind}</span>
                <span className="memo-sheet-item__preview">{[m.announcements, m.decisions, m.todos].join(' ').trim().slice(0, 60) || '비어 있음'}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );

  if (!wide) {
    return id ? (
      <div>
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('work')}>
          <ArrowLeft size={16} /> 목록
        </button>
        <MeetingEditor id={id} key={id} />
      </div>
    ) : (
      list
    );
  }

  return (
    <div className="work">
      {list}
      <div className="work__editor">
        {id ? (
          <MeetingEditor id={id} key={id} />
        ) : (
          <div className="memo-sheet memo-sheet--empty">
            <EmptyState text="왼쪽에서 회의록을 고르거나 새로 만들어 줘." expression="neutral" />
          </div>
        )}
      </div>
    </div>
  );
}

type SectionKey = 'announcements' | 'decisions' | 'todos' | 'memo';
const SECTIONS: { key: SectionKey; label: string; placeholder: string }[] = [
  { key: 'announcements', label: '전달사항', placeholder: '회의에서 전달받은 내용' },
  { key: 'decisions', label: '결정사항', placeholder: '정해진 것들' },
  { key: 'todos', label: '해야 할 일', placeholder: '- 10월 22일까지 활동지 제출\n- 금요일까지 학년 협의록 작성' },
  { key: 'memo', label: '메모', placeholder: '기타 메모' },
];

function MeetingEditor({ id }: { id: string }) {
  const m = useLiveQuery(async () => (await db.meetings.get(id)) ?? null, [id]);
  const sentTasks = useLiveQuery(() => db.tasks.where('sourceId').equals(id).toArray(), [id]) ?? [];
  const [showInk, setShowInk] = useState(false);
  const [bulk, setBulk] = useState(false);
  if (m === undefined) return null;
  if (m === null) return <EmptyState text="이 회의록을 찾을 수 없어." expression="worried" />;

  const save = (changes: Partial<MeetingNote>) => repo.update<MeetingNote>('meetings', m.id, changes);
  const sourceLabel = `${formatShort(m.date)} ${m.title || m.kind}`;

  const sendToTasks = async (text: string) => {
    const p = parseTaskText(text, m.date);
    if (!p.title) return;
    const ok = await confirmDialog({
      title: '할 일로 보내기',
      message: (
        <div className="task-preview">
          <p>□ {p.title}</p>
          <p className="muted">마감: {p.dueDate ? `${formatShort(p.dueDate)} (${relativeDue(p.dueDate)})` : '없음'}</p>
          <p className="muted">출처: {sourceLabel}</p>
        </div>
      ),
      confirmLabel: 'Tasks에 넣기',
    });
    if (!ok) return;
    await addTask({ title: p.title, dueDate: p.dueDate, sourceType: 'meeting', sourceId: m.id, sourceLabel });
    toast('Tasks에 넣었어요.', { label: '보기', run: () => navigate('tasks') });
  };

  return (
    <article className="memo-sheet">
      <PixelIcon kind="plus" size={12} color="var(--blue)" className="memo-sheet__deco" />
      <header className="memo-sheet__head">
        <AutoInput saveKey={`${m.id}:title`} value={m.title} onSave={(title) => save({ title })} className="memo-sheet__title" aria-label="회의 제목" />
        <div className="row row--wrap memo-sheet__meta">
          <select className="select memo-sheet__kind" value={m.kind} onChange={(e) => void save({ kind: e.target.value as MeetingKind })} aria-label="회의 종류">
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <input type="date" className="input memo-sheet__date" value={m.date} onChange={(e) => e.target.value && void save({ date: e.target.value })} aria-label="회의 날짜" />
          <span className="memo-sheet__en title-font">{formatEn(m.date)}</span>
        </div>
      </header>

      {SECTIONS.map((sec) => (
        <MeetingSection
          key={sec.key}
          id={`${m.id}:${sec.key}`}
          label={sec.label}
          value={m[sec.key]}
          placeholder={sec.placeholder}
          onSave={(v) => save({ [sec.key]: v } as Partial<MeetingNote>)}
          onSend={sendToTasks}
          extra={
            sec.key === 'todos' ? (
              <button className="btn btn--sm" onClick={() => setBulk(true)} disabled={!m.todos.trim()}>
                <ListChecks size={16} /> 줄마다 Tasks로
              </button>
            ) : null
          }
        />
      ))}

      {sentTasks.length > 0 && (
        <section className="memo-sheet__section">
          <h3 className="section-title">보낸 할 일</h3>
          <ul className="list-reset sent-tasks">
            {sentTasks.map((t) => (
              <li key={t.id} className={cx(t.completed && 'is-done')}>
                {t.completed ? '☑' : '☐'} {t.title} {t.dueDate && <span className="chip">{relativeDue(t.dueDate)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="memo-sheet__section">
        <div className="row row--between">
          <h3 className="section-title">필기</h3>
          <button
            className="btn btn--sm"
            onClick={async () => {
              if (!m.inkDocId) {
                const d = await createInkDoc('lined', 1200, 1200);
                await save({ inkDocId: d.id });
              }
              setShowInk(!showInk);
            }}
          >
            <PenLine size={16} /> {showInk ? '필기 닫기' : m.inkDocId ? '필기 열기' : 'Pencil로 쓰기'}
          </button>
        </div>
        {showInk && m.inkDocId && <InkCanvas docId={m.inkDocId} compactToolbar />}
      </section>

      <section className="memo-sheet__section">
        <h3 className="section-title">첨부자료</h3>
        <AttachmentBar ids={m.attachments} owner={{ type: 'meeting', id: m.id }} onChange={(attachments) => save({ attachments })} />
      </section>

      <footer className="row row--wrap memo-sheet__foot">
        <button
          className="btn btn--sm btn--ghost"
          onClick={async () => {
            await save({ archived: true });
            toast('보관함으로 옮겼어요.', { label: '되돌리기', run: () => void save({ archived: false }) });
            navigate('work');
          }}
        >
          <Archive size={16} /> 보관
        </button>
        <button
          className="btn btn--sm btn--ghost"
          onClick={async () => {
            if (await confirmDialog({ title: '회의록 삭제', message: '이 회의록을 완전히 삭제할까요? 보낸 할 일은 남아 있어요.', confirmLabel: '삭제', danger: true })) {
              await repo.remove('meetings', m.id);
              navigate('work');
            }
          }}
        >
          <Trash2 size={16} /> 삭제
        </button>
      </footer>

      <BulkTasks open={bulk} onClose={() => setBulk(false)} text={m.todos} base={m.date} source={{ id: m.id, label: sourceLabel }} already={sentTasks} />
    </article>
  );
}

function MeetingSection({
  id,
  label,
  value,
  placeholder,
  onSave,
  onSend,
  extra,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onSave: (v: string) => Promise<void>;
  onSend: (text: string) => void;
  extra?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState('');
  const readSel = () => {
    const ta = ref.current?.querySelector('textarea');
    if (!ta) return;
    setSel(ta.value.slice(ta.selectionStart, ta.selectionEnd).trim());
  };
  return (
    <section className="memo-sheet__section" ref={ref} onSelect={readSel} onKeyUp={readSel} onPointerUp={readSel}>
      <div className="row row--between">
        <h3 className="section-title">{label}</h3>
        {extra}
      </div>
      <AutoTextarea saveKey={id} value={value} onSave={onSave} lined rows={4} placeholder={placeholder} aria-label={label} />
      {sel && (
        <div className="selection-bar">
          <span className="selection-bar__text">“{sel.length > 40 ? sel.slice(0, 40) + '…' : sel}”</span>
          <button
            className="btn btn--sm btn--pink"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onSend(sel);
              setSel('');
            }}
          >
            <Send size={14} /> 할 일로 보내기
          </button>
        </div>
      )}
    </section>
  );
}

function BulkTasks({ open, onClose, text, base, source, already }: { open: boolean; onClose: () => void; text: string; base: string; source: { id: string; label: string }; already: Task[] }) {
  const lines = useMemo(
    () =>
      text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 1)
        .map((l) => ({ raw: l, ...parseTaskText(l, base) }))
        .filter((l) => l.title),
    [text, base],
  );
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const isSent = (title: string) => already.some((t) => t.title === title);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="해야 할 일 → Tasks"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className="btn btn--primary"
            disabled={!picked.size}
            onClick={async () => {
              for (const i of picked) {
                const l = lines[i];
                await addTask({ title: l.title, dueDate: l.dueDate, sourceType: 'meeting', sourceId: source.id, sourceLabel: source.label });
              }
              toast(`할 일 ${picked.size}개를 Tasks에 넣었어요.`);
              setPicked(new Set());
              onClose();
            }}
          >
            {picked.size}개 넣기
          </button>
        </>
      }
    >
      {lines.length === 0 ? (
        <p className="muted">줄마다 하나씩 적어 주면 할 일로 만들 수 있어요.</p>
      ) : (
        <ul className="list-reset bulk-list">
          {lines.map((l, i) => {
            const sent = isSent(l.title);
            return (
              <li key={i}>
                <label className={cx('check', sent && 'check--done')}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    disabled={sent}
                    checked={picked.has(i)}
                    onChange={(e) => {
                      const n = new Set(picked);
                      if (e.target.checked) n.add(i);
                      else n.delete(i);
                      setPicked(n);
                    }}
                  />
                  <span className="check__text">
                    {l.title}
                    {l.dueDate && <span className="chip">{formatShort(l.dueDate)}</span>}
                    {sent && <span className="muted"> · 이미 보냄</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
