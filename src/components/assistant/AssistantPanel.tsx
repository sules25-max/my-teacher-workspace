import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, ImagePlus, Send, ShieldCheck, X } from 'lucide-react';
import { analyzeImages, MAX_IMAGES, prepareImage, type PreparedImage } from '../../services/ai/vision';
import { toast } from '../common/overlays';
import { AssistantAvatar } from './AssistantAvatar';
import { AgentScene } from '../agent/AgentScene';
import { react } from '../agent/agentStore';
import { AssistantMessage, type ChatMessage } from './AssistantMessage';
import { AssistantQuickActions } from './AssistantQuickActions';
import type { AssistantExpression } from './sprite';
import { useSettings } from '../../hooks/useData';
import { useRoute } from '../../hooks/useRoute';
import { findLagging, findMemos, fromGrounded, localAnswer, openTasks, prepareNext, tidyMeeting, weekSummary, type AssistantReply, type QuickActionId } from '../../services/ai/assistant';
import { askWithRecords, NOT_FOUND } from '../../services/ai/grounded';
import { openDailySummary } from './DailySummary';
import { getAIProvider } from '../../services/ai/provider';
import { cx } from '../../utils/id';

interface Props {
  open: boolean;
  onClose: () => void;
  expression: AssistantExpression;
  setExpression: (e: AssistantExpression) => void;
}

let msgSeq = 1;

export function AssistantPanel({ open, onClose, setExpression }: Props) {
  const s = useSettings();
  const route = useRoute();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'ask' | 'find'>('ask');
  const [input, setInput] = useState('');
  const [includeCtx, setIncludeCtx] = useState(true);
  // ---------- 이미지 첨부(전송용 사본은 메모리에만) ----------
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const addImages = async (files: FileList | File[]) => {
    const list = [...files];
    const room = MAX_IMAGES - images.length;
    if (room <= 0) return toast(`이미지는 한 번에 ${MAX_IMAGES}장까지 보낼 수 있어요.`);
    if (list.length > room) toast(`한 번에 ${MAX_IMAGES}장까지라 앞의 ${room}장만 붙였어요. 나머지는 다음 질문에 보내 주세요.`);
    for (const f of list.slice(0, room)) {
      setPreparing((n) => n + 1);
      try {
        const p = await prepareImage(f);
        setImages((xs) => [...xs, p]);
      } catch (e) {
        toast((e as Error).message);
      } finally {
        setPreparing((n) => n - 1);
      }
    }
  };
  const removeImage = (id: string) =>
    setImages((xs) => {
      const x = xs.find((i) => i.id === id);
      if (x) setTimeout(() => URL.revokeObjectURL(x.previewUrl), 60000);
      return xs.filter((i) => i.id !== id);
    });
  const submitVision = async (q: string) => {
    if (busy) return;
    const sent = images;
    push({ role: 'user', text: q, images: sent.map((i) => i.previewUrl) });
    setBusy(true);
    setProgress('이미지를 읽고 있어요…');
    setExpression('thinking');
    react('thinking');
    try {
      const v = await analyzeImages(s, q, sent);
      setInput('');
      setImages([]); // 성공했을 때만 비운다(실패하면 그대로 다시 보낼 수 있게)
      reply({
        text: v.extract.unreadable ? `${v.text}\n\n(이미지에서 내용을 확실히 읽기 어려웠어요.)` : v.text,
        expression: v.extract.unreadable ? 'worried' : 'happy',
        footer: `이미지 ${sent.length}장 분석${v.model ? ` · ${v.model}` : ''}${v.fallback ? ' (대체 모델)' : ''}`,
        vision: { result: v, images: sent, question: q },
      });
      react('answer');
    } catch (e) {
      react('error');
      reply({ text: `${(e as Error).message}`, expression: 'worried', footer: '업무수첩 데이터와 첨부파일은 그대로예요.' });
    } finally {
      setBusy(false);
      setProgress('');
    }
  };
  const [progress, setProgress] = useState('');
  const [remote, setRemote] = useState(false);
  // 채팅 공간을 넓게 쓰고 싶을 때 방(장면)을 접어 둔다. 기기에 기억
  const [sceneCollapsed, setSceneCollapsedState] = useState(() => {
    try {
      return localStorage.getItem('mtw.agent.collapsed') === '1';
    } catch {
      return false;
    }
  });
  const setSceneCollapsed = (v: boolean) => {
    setSceneCollapsedState(v);
    try {
      localStorage.setItem('mtw.agent.collapsed', v ? '1' : '0');
    } catch {
      /* 무시 */
    }
  };
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const provider = getAIProvider(s);

  useEffect(() => {
    if (!open) return;
    react('greet');
    provider.available().then(setRemote);
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

  const run = async (label: string, fn: () => Promise<AssistantReply>, kind: 'thinking' | 'search' = 'thinking') => {
    push({ role: 'user', text: label });
    setBusy(true);
    setExpression('thinking');
    react(kind); // AI 이나: 생각하기 / 자료실로 찾으러 가기
    try {
      reply(await fn());
      react(kind === 'search' ? 'found' : 'answer');
    } catch (e) {
      reply({ text: `앗, 문제가 생겼어: ${(e as Error).message}`, expression: 'worried' });
      react('error');
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
      case 'daily':
        openDailySummary();
        return;
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
    if (images.length) return submitVision(q || '이 이미지 내용을 알려줘.');
    if (!q || busy) return;
    setInput('');
    if (mode === 'find') {
      setMode('ask');
      return run(q, () => findMemos(q, s), 'search');
    }
    if (!remote || !includeCtx) return run(q, () => localAnswer(q, s, route), 'search');
    // 먼저 내 기록을 검색하고, 찾은 기록만 근거로 AI가 답한다(grounded.ts)
    push({ role: 'user', text: q });
    setBusy(true);
    setExpression('thinking');
    react('search');
    try {
      const history = messages.filter((m) => m.text && m.role === 'user').map((m) => ({ role: m.role, content: m.text }));
      const g = await askWithRecords(s, provider, q, history, setProgress);
      reply(fromGrounded(g));
      react(g.text.trim() === NOT_FOUND ? 'error' : g.debug.mode === 'summary' ? 'found' : 'answer');
    } catch (e) {
      react('error');
      reply({ text: `외부 AI에 연결하지 못했어 (${(e as Error).message}). 대신 기기 안에서 찾은 기록을 보여줄게.`, expression: 'worried' });
      reply(await localAnswer(q, s, route));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  if (!open) return null;
  return createPortal(
    <>
      <div className="ai-scrim" onClick={onClose} />
      <aside
        className={cx('ai-panel', dragOver && 'is-dragover')}
        role="dialog"
        aria-label="AI 이나"
        aria-modal="false"
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void addImages(e.dataTransfer.files);
        }}
      >
        <header className="ai-panel__head">
          <div className="ai-panel__title">
            <span className="title-font">AI 이나</span>
            <span className="ai-panel__provider muted">
              <ShieldCheck size={13} /> {remote ? provider.label : '기기 안에서만 동작'}
            </span>
          </div>
          <button
            className="icon-btn"
            onClick={() => setSceneCollapsed(!sceneCollapsed)}
            aria-pressed={sceneCollapsed}
            aria-label={sceneCollapsed ? 'AI 이나의 방 펼치기' : 'AI 이나의 방 접기'}
            title={sceneCollapsed ? '방 펼치기' : '방 접기'}
          >
            {sceneCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="비서 닫기">
            <X size={20} />
          </button>
        </header>
        <div className={cx('ai-panel__scene', sceneCollapsed && 'is-collapsed')}>
          <AgentScene size="large" />
        </div>

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
              <AssistantMessage key={m.id} m={m} onActionResult={(t) => {
                if (!t) return setExpression('neutral');
                react(t.startsWith('앗') ? 'error' : 'done'); // 반영 완료 → 기뻐하기
                reply({ text: t, expression: t.startsWith('앗') ? 'worried' : 'happy' });
              }} />
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
                {progress && <span className="ai-msg__progress muted">{progress}</span>}
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
          {remote && mode === 'ask' && (
            <label className={cx('ai-ctx', !includeCtx && 'is-off')}>
              <input type="checkbox" checked={includeCtx} onChange={(e) => setIncludeCtx(e.target.checked)} />
              질문과 관련된 내 기록만 찾아서 AI에 보내기 (사진 · 손글씨 제외){!includeCtx && ' — 끄면 기기 안 검색 결과만 보여줘요'}
            </label>
          )}
          {images.length > 0 && (
            <ul className="list-reset ai-attach" aria-label="첨부한 이미지">
              {images.map((im) => (
                <li key={im.id} className="ai-attach__item">
                  <img src={im.previewUrl} alt={im.file.name} />
                  <button type="button" className="ai-attach__remove" onClick={() => removeImage(im.id)} aria-label={`${im.file.name} 빼기`}>
                    ×
                  </button>
                </li>
              ))}
              {preparing > 0 && <li className="ai-attach__item ai-attach__item--loading">준비 중…</li>}
            </ul>
          )}
          <div className="row">
            <button type="button" className="icon-btn icon-btn--outline" onClick={() => fileRef.current?.click()} aria-label="이미지 첨부" title="이미지 첨부 (붙여넣기 · 끌어놓기도 돼요)" disabled={busy}>
              <ImagePlus size={18} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && (void addImages(e.target.files), (e.target.value = ''))} />
            <input
              ref={inputRef}
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean) as File[];
                if (files.length) {
                  e.preventDefault();
                  void addImages(files);
                }
              }}
              placeholder={images.length ? '이미지에 대해 물어보기 예) 여기 일정만 찾아줘' : mode === 'find' ? '찾을 단어' : '예) 지난번 4학년 시장놀이 메모 찾아줘'}
              aria-label={mode === 'find' ? '찾을 메모' : '비서에게 질문'}
              enterKeyHint="send"
            />
            <button className="icon-btn icon-btn--outline" disabled={(!input.trim() && !images.length) || busy || preparing > 0} aria-label="보내기">
              <Send size={18} />
            </button>
          </div>
        </form>
      </aside>
    </>,
    document.body,
  );
}
