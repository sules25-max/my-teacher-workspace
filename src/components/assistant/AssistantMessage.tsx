import type { AssistantReply } from '../../services/ai/assistant';
import { AssistantAvatar } from './AssistantAvatar';
import { AssistantConfirmation } from './AssistantConfirmation';
import { navigate } from '../../hooks/useRoute';
import { openLesson } from '../planner/lessonDrawerStore';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  reply?: AssistantReply;
  contextLabel?: string;
}

export function AssistantMessage({ m, onActionResult }: { m: ChatMessage; onActionResult: (text: string | null) => void }) {
  if (m.role === 'user') {
    return (
      <li className="ai-msg ai-msg--user">
        <div className="ai-msg__text">{m.text}</div>
        {m.contextLabel && <span className="ai-msg__ctx muted">보낸 정보: {m.contextLabel}</span>}
      </li>
    );
  }
  const r = m.reply;
  return (
    <li className="ai-msg ai-msg--ai">
      <AssistantAvatar expression={r?.expression ?? 'neutral'} size={36} />
      <div className="ai-msg__body">
        <div className="ai-msg__text">{m.text}</div>
        {r?.links && r.links.length > 0 && (
          <div className="row row--wrap ai-msg__links">
            {r.links.map((l, i) => (
              <button key={i} className="chip" onClick={() => (l.lessonId ? openLesson({ recordId: l.lessonId }) : l.href && navigate(l.href))}>
                {l.label} →
              </button>
            ))}
          </div>
        )}
        {r?.action && <AssistantConfirmation action={r.action} onResult={onActionResult} />}
      </div>
    </li>
  );
}
