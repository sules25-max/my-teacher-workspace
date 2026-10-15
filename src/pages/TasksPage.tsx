import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Star } from 'lucide-react';
import { db } from '../services/localDb';
import { addTask, BUCKET_LABEL, parseTaskText, sortTasks, taskBucket, type TaskBucket } from '../services/tasks';
import { TaskItem } from '../components/tasks/TaskItem';
import { EmptyState } from '../components/common/EmptyState';
import { addDays, isoWeekday, relativeDue, todayISO } from '../utils/date';
import { cx } from '../utils/id';

type Filter = 'all' | 'today' | 'week' | 'later' | 'important' | 'done';
const FILTERS: [Filter, string][] = [
  ['all', '전체'],
  ['today', '오늘'],
  ['week', '이번 주'],
  ['later', '나중에'],
  ['important', '중요'],
  ['done', '완료'],
];

export function TasksPage() {
  const today = todayISO();
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) ?? [];
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  const [due, setDue] = useState<string | undefined>(undefined);
  const [important, setImportant] = useState(false);
  const parsed = parseTaskText(text, today);
  const effectiveDue = due === 'none' ? undefined : (due ?? parsed.dueDate);
  const friday = addDays(today, Math.max(0, 5 - isoWeekday(today)));

  const groups = useMemo(() => {
    const visible = tasks.filter((t) => {
      const b = taskBucket(t, today);
      switch (filter) {
        case 'all':
          return b !== 'done';
        case 'today':
          return b === 'today' || b === 'overdue';
        case 'week':
          return b === 'week' || b === 'today' || b === 'overdue';
        case 'later':
          return b === 'later';
        case 'important':
          return !!t.important && b !== 'done';
        case 'done':
          return b === 'done';
      }
    });
    const order: TaskBucket[] = ['overdue', 'today', 'week', 'later', 'done'];
    return order
      .map((b) => ({
        bucket: b,
        items: visible
          .filter((t) => taskBucket(t, today) === b)
          .sort(b === 'done' ? (x, y) => ((x.completedAt ?? '') < (y.completedAt ?? '') ? 1 : -1) : sortTasks),
      }))
      .filter((g) => g.items.length);
  }, [tasks, filter, today]);

  const submit = async () => {
    if (!text.trim()) return;
    await addTask({ title: due ? text : parsed.title, dueDate: effectiveDue, important });
    setText('');
    setDue(undefined);
    setImportant(false);
  };

  return (
    <div className="tasks-page">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">할 일</h1>
          <p className="page-head__sub">남은 일 {tasks.filter((t) => !t.completed).length}개</p>
        </div>
      </div>

      <form
        className="card task-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="row">
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="예) 10월 22일까지 활동지 제출"
            aria-label="새 할 일"
            enterKeyHint="done"
          />
          <button type="button" className={cx('icon-btn icon-btn--outline task__star', important && 'is-on')} aria-pressed={important} onClick={() => setImportant(!important)} aria-label="중요">
            <Star size={18} fill={important ? 'var(--orange)' : 'none'} />
          </button>
          <button className="btn btn--primary" disabled={!text.trim()}>
            <Plus size={18} /> 추가
          </button>
        </div>
        <div className="row row--wrap task-composer__due">
          {[
            ['오늘', today],
            ['내일', addDays(today, 1)],
            ['이번 주 금', friday],
            ['기한 없음', 'none'],
          ].map(([label, v]) => (
            <button type="button" key={label} className={cx('chip', due === v && 'chip--done')} aria-pressed={due === v} onClick={() => setDue(due === v ? undefined : v)}>
              {label}
            </button>
          ))}
          <input type="date" className="input task-composer__date" value={due && due !== 'none' ? due : ''} onChange={(e) => setDue(e.target.value || undefined)} aria-label="기한 직접 선택" />
          {text && effectiveDue && <span className="muted">→ 기한 {relativeDue(effectiveDue)}</span>}
        </div>
      </form>

      <div className="seg tasks-filter" role="tablist" aria-label="할 일 보기">
        {FILTERS.map(([f, label]) => (
          <button key={f} role="tab" aria-selected={filter === f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <EmptyState text={filter === 'done' ? '아직 완료한 일이 없어.' : '여기엔 할 일이 없어. 깔끔해!'} expression="happy" />
      ) : (
        groups.map((g) => (
          <section key={g.bucket} className={cx('task-group', `task-group--${g.bucket}`)}>
            <h2 className="section-title">
              {BUCKET_LABEL[g.bucket]} <span className="chip">{g.items.length}</span>
            </h2>
            <ul className="list-reset task-list card">
              {g.items.map((t) => (
                <TaskItem key={t.id} task={t} editable />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
