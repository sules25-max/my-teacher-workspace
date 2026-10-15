import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, ShieldCheck, X } from 'lucide-react';
import { AssistantAvatar } from './AssistantAvatar';
import { AssistantMessage, type ChatMessage } from './AssistantMessage';
import { AssistantQuickActions } from './AssistantQuickActions';
import type { AssistantExpression } from './sprite';
import { useSettings } from '../../hooks/useData';
import { useRoute } from '../../hooks/useRoute';
import { findLagging, findMemos, localAnswer, openTasks, prepareNext, tidyMeeting, weekSummary, type AssistantReply, type QuickActionId } from '../../services/ai/assistant';
import { getAIProvider, type AIContext } from '../../services/ai/provider';
import { buildContext } from '../../services/ai/context';
import { cx } from '../../utils/id';

interface Props {
  open: boolean;
  onClose: () => void;
  expression: AssistantExpression;
  setExpression: (e: AssistantExpression) => void;
}

let msgSeq = 1;

export function AssistantPanel({ open, onClose, expression, setExpression }: Props) {
  const s = useSettings();
  const route = useRoute();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'ask' | 'find'>('ask');
  const [input, setInput] = useState('');
  const [ctx, setCtx] = useState<AIContext | null>(null);
  const [includeCtx, setIncludeCtx] = useState(true);
  const [remote, setRemote] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const provider = getAIProvider(s);

  useEffect(() => {
    if (!open) return;
    provider.available().then(setRemote);
    buildContext(route).then(setCtx);
  }, [open, route.name, route.params.join('/'), s.ai.provider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const push = (m: Omit<ChatMessage, 'id'>) => setMessages((ms) => [...ms, { ...m, id: msgSeq++ }]);
  const reply = (r: AssistantReply) => {
    push({ role: 'assistant', text: r.text, reply: r });
    setExpression(r.expression);
  };

  const run = async (label: string, fn: () => Promise<AssistantReply>) => {
    push({ role: 'user', text: label });
    setBusy(true);
    setExpression('thinking');
    try {
      reply(await fn());
    } catch (e) {
      reply({ text: `앗, 문제가 생겼어: ${(e as Error).message}`, expression: 'worried' });
    } finally {
      setBusy(false);
    }
  };

  const onQuick = (id: QuickActionId) => {
    switch (id) {
      case 'week':
        return run('이번 주 수업 정리해 줘', weekSummary);
      case 'tasks':
        return run('미완료 업무 보여 줘', openTasks);
      case 'meeting':
        return run('회의 메모 정리해 줘', () => tidyMeeting(route));
      case 'next':
        return run('다음 차시 준비 도와줘', () => prepareNext(s));
      case 'lagging':
        return run('진도 늦은 반 찾아 줘', () => findLagging(s));
      case 'find':
        setMode('find');
        push({ role: 'assistant', text: '어떤 메모를 찾을까? 예) 4학년 시장놀이', reply: { text: '', expression: 'thinking' } });
        setExpression('thinking');
        setTimeout(() => inputRef.current?.focus(), 30);
        return;
      case 'ask':
        setMode('ask');
        push({
          role: 'assistant',
          text: remote ? '뭐든 물어봐. 지금 화면과 관련된 정보만 조금 보낼게.' : '물어봐! 지금은 기기 안 비서 모드라 할 일·진도·메모 찾기 위주로 답할 수 있어.',
          reply: { text: '', expression: 'happy' },
        });
        setExpression('happy');
        setTimeout(() => inputRef.current?.focus(), 30);
        return;
    }
  };

  const submit = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    if (mode === 'find') {
      setMode('ask');
      return run(q, () => findMemos(q));
    }
    if (!remote) return run(q, () => localAnswer(q, s, route));
    const sendCtx = includeCtx ? ctx : null;
    push({ role: 'user', text: q, contextLabel: sendCtx?.label ?? '없음' });
    setBusy(true);
    setExpression('thinking');
    try {
      const history = messages.filter((m) => m.text).map((m) => ({ role: m.role, content: m.text }));
      const text = await provider.chat([...history, { role: 'user', content: q }], sendCtx);
      reply({ text: text || '음… 답을 못 만들었어.', expression: 'confident' });
    } catch (e) {
      reply({ text: `외부 AI에 연결하지 못했어 (${(e as Error).message}). 기기 안에서 찾아볼게.`, expression: 'worried' });
      reply(await localAnswer(q, s, route));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return createPortal(
    <>
      <div className="ai-scrim" onClick={onClose} />
      <aside className="ai-panel" role="dialog" aria-label="AI 이나" aria-modal="false">
        <header className="ai-panel__head">
          <AssistantAvatar expression={busy ? 'thinking' : expression} size={46} />
          <div className="ai-panel__title">
            <span className="title-font">AI 이나</span>
            <span className="ai-panel__provider muted">
              <ShieldCheck size={13} /> {remote ? provider.label : '기기 안에서만 동작'}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="비서 닫기">
            <X size={20} />
          </button>
        </header>

        <ul className="list-reset ai-panel__messages" ref={listRef} aria-live="polite">
          {messages.length === 0 && (
            <li className="ai-msg ai-msg--ai">
              <AssistantAvatar expression="neutral" size={36} />
              <div className="ai-msg__body">
                <div className="ai-msg__text">오늘 뭐 도와줄까? 아래에서 골라 줘. 내가 뭘 바꾸려고 하면 꼭 먼저 물어볼게.</div>
              </div>
            </li>
          )}
          {messages
            .filter((m) => m.text)
            .map((m) => (
              <AssistantMessage key={m.id} m={m} onActionResult={(t) => (t ? reply({ text: t, expression: t.startsWith('앗') ? 'worried' : 'happy' }) : setExpression('neutral'))} />
            ))}
          {busy && (
            <li className="ai-msg ai-msg--ai">
              <AssistantAvatar expression="thinking" size={36} />
              <div className="ai-msg__body">
                <div className="ai-msg__text ai-typing" aria-label="생각 중">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </li>
          )}
        </ul>

        <AssistantQuickActions onPick={onQuick} disabled={busy} />

        <form
          className="ai-panel__input"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {remote && mode === 'ask' && ctx && (
            <label className={cx('ai-ctx', !includeCtx && 'is-off')}>
              <input type="checkbox" checked={includeCtx} onChange={(e) => setIncludeCtx(e.target.checked)} />
              보낼 정보: {ctx.label}
            </label>
          )}
          <div className="row">
            <input
              ref={inputRef}
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === 'find' ? '찾을 단어' : '예) 지난번 4학년 시장놀이 메모 찾아줘'}
              aria-label={mode === 'find' ? '찾을 메모' : '비서에게 질문'}
              enterKeyHint="send"
            />
            <button className="icon-btn icon-btn--outline" disabled={!input.trim() || busy} aria-label="보내기">
              <Send size={18} />
            </button>
          </div>
        </form>
      </aside>
    </>,
    document.body,
  );
}
