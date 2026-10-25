import { useState } from 'react';
import { Star, Trash2, CalendarClock, X } from 'lucide-react';
import type { Task } from '../../types';
import * as repo from '../../services/repo';
import { toggleTask } from '../../services/tasks';
import { relativeDue, todayISO } from '../../utils/date';
import { cx } from '../../utils/id';
import { toast } from '../common/overlays';
import { navigate } from '../../hooks/useRoute';

export function TaskItem({ task, editable = false }: { task: Task; editable?: boolean }) {
  const [editingDue, setEditingDue] = useState(false);
  const overdue = !task.completed && task.dueDate && task.dueDate < todayISO();
  const sourceHref = task.sourceType === 'meeting' && task.sourceId ? `work/${task.sourceId}` : task.sourceType === 'page' && task.sourceId ? `board/${task.sourceId}` : null;
  return (
    <li className={cx('task', task.completed && 'is-done', task.important && 'is-important')}>
      <label className="task__check">
        <input
          type="checkbox"
          className="checkbox"
          checked={task.completed}
          onChange={() => void toggleTask(task)}
          aria-label={`${task.title} ${task.completed ? '완료 취소' : '완료'}`}
        />
      </label>
      <div className="task__body">
        <span className="task__title">{task.title}</span>
        <span className="task__meta">
          {task.dueDate && <span className={cx('chip', overdue && 'chip--warn')}>{relativeDue(task.dueDate)}</span>}
          {task.sourceLabel &&
            (sourceHref ? (
              <button className="task__source" onClick={() => navigate(sourceHref)}>
                출처: {task.sourceLabel}
              </button>
            ) : (
              <span className="task__source">출처: {task.sourceLabel}</span>
            ))}
        </span>
        {editable && editingDue && (
          <div className="row task__due-edit">
            <input
              type="date"
              className="input"
              defaultValue={task.dueDate ?? ''}
              onChange={(e) => void repo.update<Task>('tasks', task.id, { dueDate: e.target.value || undefined })}
              aria-label="기한"
            />
            <button className="icon-btn" onClick={() => setEditingDue(false)} aria-label="기한 편집 닫기">
              <X size={18} />
            </button>
          </div>
        )}
      </div>
      <button
        className={cx('icon-btn task__star', task.important && 'is-on')}
        onClick={() => void repo.update<Task>('tasks', task.id, { important: !task.important })}
        aria-label={task.important ? '중요 표시 해제' : '중요 표시'}
        aria-pressed={!!task.important}
      >
        <Star size={18} fill={task.important ? 'var(--orange)' : 'none'} />
      </button>
      {editable && (
        <>
          <button className="icon-btn" onClick={() => setEditingDue((v) => !v)} aria-label="기한 바꾸기">
            <CalendarClock size={18} />
          </button>
          <button
            className="icon-btn"
            onClick={async () => {
              const snapshot = { ...task };
              await repo.remove('tasks', task.id);
              toast('할 일을 지웠어요.', { label: '되돌리기', run: () => void repo.put('tasks', snapshot) });
            }}
            aria-label="삭제"
          >
            <Trash2 size={18} />
          </button>
        </>
      )}
    </li>
  );
}
