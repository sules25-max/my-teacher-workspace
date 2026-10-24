import type { AssistantReply } from '../../services/ai/assistant';
import { AssistantAvatar } from './AssistantAvatar';
import { AssistantConfirmation } from './AssistantConfirmation';
import { navigate } from '../../hooks/useRoute';
import { openLesson } from '../planner/lessonDrawerStore';
import { useDevMode } from '../../services/devMode';
import { VisionActions } from './VisionActions';
import type { AIDebug } from '../../services/ai/grounded';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  reply?: AssistantReply;
  contextLabel?: string;
  images?: string[]; // 사용자가 보낸 이미지 미리보기
}

export function AssistantMessage({ m, onActionResult }: { m: ChatMessage; onActionResult: (text: string | null) => void }) {
  const dev = useDevMode();
  if (m.role === 'user') {
    return (
      <li className="ai-msg ai-msg--user">
        {m.images && m.images.length > 0 && (
          <div className="ai-msg__images">
            {m.images.map((u, i) => (
              <img key={i} src={u} alt={`보낸 이미지 ${i + 1}`} />
            ))}
          </div>
        )}
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
        {r?.vision && <VisionActions v={r.vision.result} images={r.vision.images} question={r.vision.question} />}
        {r?.footer && <span className="ai-msg__footer">{r.footer}</span>}
        {dev && r?.debug && <DebugRecords debug={r.debug} />}
        {r?.action && <AssistantConfirmation action={r.action} onResult={onActionResult} />}
      </div>
    </li>
  );
}

/** 개발자 모드 전용: AI가 실제로 검색하고 사용한 기록 */
function DebugRecords({ debug }: { debug: AIDebug }) {
  const mode = { answer: '검색 후 AI 답변', summary: '단계적 요약', list: '기기 안 검색(AI 미사용)', none: '검색 결과 없음(AI 미호출)' }[debug.mode];
  return (
    <details className="ai-debug">
      <summary>
        🔧 검색된 기록 {debug.matched}건 · AI에 보낸 기록 {debug.mode === 'answer' || debug.mode === 'summary' ? debug.used.length : 0}건
      </summary>
      <div className="ai-debug__body">
        <p>방식: {mode}{debug.note ? ` · ${debug.note}` : ''}</p>
        <p>조건: {debug.conditions}</p>
        <p>
          전체 기록 {debug.corpusSize}건 · 보낸 글자 {debug.sentChars.toLocaleString()} · AI 요청 {debug.calls}번
        </p>
        <ul className="list-reset">
          {debug.used.slice(0, 60).map((u) => (
            <li key={u.key}>
              {u.date ?? '날짜 없음'} / {u.kind} / {u.title}
            </li>
          ))}
          {debug.used.length > 60 && <li>…외 {debug.used.length - 60}건</li>}
        </ul>
      </div>
    </details>
  );
}
