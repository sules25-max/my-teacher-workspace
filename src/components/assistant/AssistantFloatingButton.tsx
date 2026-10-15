import { useEffect, useRef, useState } from 'react';
import { AgentScene } from '../agent/AgentScene';
import { AssistantBubble } from './AssistantBubble';
import { AssistantPanel } from './AssistantPanel';
import type { AssistantExpression } from './sprite';
import { useRoute } from '../../hooks/useRoute';
import { useSettings } from '../../hooks/useData';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cx } from '../../utils/id';

const HINTS: Record<string, string> = {
  today: '오늘 뭐 도와줄까?',
  week: '이번 주 수업 정리해볼까?',
  progress: '진도 늦은 반 찾아볼까?',
  work: '회의 메모에서 할 일 뽑아줄까?',
  tasks: '밀린 일 같이 볼까?',
  month: '다음 일정 챙겨볼까?',
};

const POS_KEY = 'mtw.assistant.pos';

function loadPos(): { x: number; y: number } | null {
  try {
    const v = localStorage.getItem(POS_KEY);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

/** 화면 우측 하단의 작은 비서. 드래그로 옮길 수 있고 눌러야 패널이 열린다. */
export function AssistantFloatingButton() {
  const s = useSettings();
  const route = useRoute();
  const mobile = useMediaQuery('(max-width: 767px)');
  const [open, setOpen] = useState(false);
  const [expression, setExpression] = useState<AssistantExpression>('neutral');
  const [bubble, setBubble] = useState(true);
  const [offset, setOffset] = useState(loadPos);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  // 화면이 바뀌면 짧게 말풍선을 보여주고 사라진다
  useEffect(() => {
    setBubble(true);
    const t = setTimeout(() => setBubble(false), 6500);
    return () => clearTimeout(t);
  }, [route.name]);

  // 아무 일 없을 때 표정은 천천히 neutral로 돌아온다
  useEffect(() => {
    if (open || expression === 'neutral') return;
    const t = setTimeout(() => setExpression('neutral'), 12000);
    return () => clearTimeout(t);
  }, [expression, open]);

  if (!s.assistant.visible) return null;

  // 작은 방(장면) 크기: CSS .agent-scene--mini 와 맞춘다
  const size = mobile ? 104 : 148;
  const sceneH = Math.round(size * 0.75) + 20; // 장면 + 아래 상태 줄
  const style = offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined;

  return (
    <>
      <div className={cx('ai-float', open && 'is-open')} style={style}>
        {bubble && !open && (
          <button className="ai-float__bubble" onClick={() => setOpen(true)} tabIndex={-1}>
            <AssistantBubble>{HINTS[route.name] ?? '도와줄 일 있어?'}</AssistantBubble>
          </button>
        )}
        <button
          className="ai-float__btn"
          aria-label="AI 비서 열기"
          aria-expanded={open}
          onPointerDown={(e) => {
            drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: offset?.x ?? 0, oy: offset?.y ?? 0, moved: false };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            const dx = e.clientX - d.sx;
            const dy = e.clientY - d.sy;
            if (!d.moved && Math.hypot(dx, dy) < 6) return;
            d.moved = true;
            const maxX = 0;
            const minX = -(window.innerWidth - size - 24);
            const maxY = 0;
            const minY = -(window.innerHeight - sceneH - 140);
            setOffset({ x: Math.min(maxX, Math.max(minX, d.ox + dx)), y: Math.min(maxY, Math.max(minY, d.oy + dy)) });
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (d?.moved) {
              try {
                localStorage.setItem(POS_KEY, JSON.stringify(offset));
              } catch {
                /* 무시 */
              }
              return;
            }
            setOpen((o) => !o);
            setBubble(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen((o) => !o);
            }
          }}
        >
          <AgentScene size="mini" />
          <span className="ai-float__dot" aria-hidden="true" />
        </button>
      </div>
      <AssistantPanel open={open} onClose={() => setOpen(false)} expression={expression} setExpression={setExpression} />
    </>
  );
}
