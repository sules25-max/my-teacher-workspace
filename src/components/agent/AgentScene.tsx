import { useEffect, useRef, useState } from 'react';
import { useAgentView, type BubbleId } from './agentStore';
import { PLACE_LABEL, type Place, type PoseId } from '../../services/agent/status';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cx } from '../../utils/id';

const BASE = `${import.meta.env.BASE_URL}agent/`;
const PLACES: Place[] = ['classroom', 'staffroom', 'lounge', 'meeting', 'library', 'hallway'];
const bgSrc = (p: Place) => `${BASE}bg-${p}.webp`;
const poseSrc = (p: PoseId) => `${BASE}pose-${p}.webp`;
const walkSrc = (dir: 'side' | 'back' | 'front', f: number) => `${BASE}walk-${dir}-${f + 1}.webp`;
const bubbleSrc = (b: BubbleId) => `${BASE}bubble-${b}.webp`;

/** 장소마다 캐릭터가 서는 곳(가로 %, 바닥에서 %) */
const SPOT: Record<Place, { x: number; bottom: number }> = {
  classroom: { x: 64, bottom: 3 },
  staffroom: { x: 50, bottom: 2 },
  lounge: { x: 56, bottom: 5 },
  meeting: { x: 50, bottom: 0 },
  library: { x: 42, bottom: 4 },
  hallway: { x: 50, bottom: 8 },
};

/** 포즈 그림마다 소품 크기가 달라 장면 높이 대비 비율을 따로 둔다 */
const POSE_H: Record<PoseId, number> = {
  idle: 0.62,
  joy: 0.64,
  talk: 0.56,
  think: 0.64,
  work: 0.56,
  teach: 0.64,
  meeting: 0.56,
  sit: 0.52,
  rest: 0.54,
  doze: 0.5,
  surprised: 0.58,
  'walk-away': 0.56,
};
const WALK_H = 0.56;

// 처음 한 번 모든 그림을 미리 받아 두어 동작이 끊기지 않게 한다
let preloaded = false;
function preload() {
  if (preloaded) return;
  preloaded = true;
  const urls = [
    ...PLACES.map(bgSrc),
    ...(['idle', 'joy', 'talk', 'think', 'work', 'teach', 'meeting', 'sit', 'rest', 'doze', 'surprised'] as PoseId[]).map(poseSrc),
    ...[0, 1, 2, 3, 4, 5].flatMap((f) => [walkSrc('side', f), walkSrc('back', f)]),
    ...(['dots', 'heart', 'sparkle', 'question', 'bang'] as BubbleId[]).map(bubbleSrc),
  ];
  urls.forEach((u) => {
    const i = new Image();
    i.src = u;
  });
}

type Mode = 'pose' | 'walk' | 'leave' | 'enter';

interface Props {
  size?: 'mini' | 'large';
  className?: string;
}

/** AI 이나가 사는 작은 방. 시간표에 따라 장소를 옮겨 다니고, 한가하면 방 안을 걸어 다닌다. */
export function AgentScene({ size = 'large', className }: Props) {
  const view = useAgentView();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [shown, setShown] = useState<Place>(view.place);
  const [mode, setMode] = useState<Mode>('pose');
  const [x, setX] = useState(SPOT[view.place].x);
  const [dur, setDur] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [frame, setFrame] = useState(0);
  const xRef = useRef(x);
  xRef.current = x;
  const placeRef = useRef(view.place);
  placeRef.current = view.place;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(preload, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  const moveTo = (tx: number, then: () => void) => {
    const ms = Math.max(450, Math.abs(tx - xRef.current) * 42);
    setDir(tx >= xRef.current ? 1 : -1);
    setDur(ms);
    requestAnimationFrame(() => setX(tx));
    later(then, ms);
  };

  // 데이터를 다 읽은 첫 순간에는 걸어가지 않고 그 자리에서 시작한다
  const settled = useRef(false);

  // 장소가 바뀌면 오른쪽으로 걸어 나갔다가 새 장소에 왼쪽에서 걸어 들어온다
  useEffect(() => {
    if (!view.ready) return;
    const first = !settled.current;
    settled.current = true;
    if (view.place === shown) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (reduced || first) {
      setShown(view.place);
      setDur(0);
      setX(SPOT[view.place].x);
      setMode('pose');
      return;
    }
    setMode('leave');
    moveTo(114, () => {
      const target = placeRef.current;
      setShown(target);
      setDur(0);
      setX(-14);
      setMode('enter');
      later(() => moveTo(SPOT[target].x, () => setMode('pose')), 80);
    });
  }, [view.place, view.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // 한가할 때는 방 안을 왔다 갔다
  useEffect(() => {
    if (mode !== 'pose' || reduced || view.place !== shown) return;
    const home = SPOT[shown].x;
    if (!view.wander) {
      if (Math.abs(xRef.current - home) > 2) {
        setMode('walk');
        moveTo(home, () => setMode('pose'));
      }
      return;
    }
    const t = setTimeout(() => {
      let tx = 26 + Math.random() * 48;
      if (Math.abs(tx - xRef.current) < 12) tx = home;
      setMode('walk');
      moveTo(tx, () => setMode('pose'));
    }, 6000 + Math.random() * 8000);
    return () => clearTimeout(t);
  }, [mode, view.wander, view.place, shown, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // 걷는 동안(또는 퇴근하는 뒷모습) 프레임을 넘긴다
  const animating = mode !== 'pose' || view.pose === 'walk-away';
  useEffect(() => {
    if (!animating || reduced) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % 6), 115);
    return () => clearInterval(t);
  }, [animating, reduced]);

  const walking = mode !== 'pose';
  const src = walking ? walkSrc('side', frame) : view.pose === 'walk-away' ? walkSrc('back', frame) : poseSrc(view.pose);
  const h = walking ? WALK_H : POSE_H[view.pose];
  const spot = SPOT[shown];
  const showBubble = !walking && view.bubble;

  return (
    <div className={cx('agent-card', `agent-card--${size}`, view.reacting && 'is-reacting', className)}>
    <div className={cx('agent-scene', `agent-scene--${size}`)} aria-label={`AI 이나: ${PLACE_LABEL[shown]}에서 ${view.label}`} role="img">
      {PLACES.map((p) => (
        <img key={p} className={cx('agent-scene__bg', p === shown && 'is-shown')} src={bgSrc(p)} alt="" draggable={false} />
      ))}
      <div className="agent-scene__track" style={{ transform: `translateX(${x}%)`, transition: dur ? `transform ${dur}ms linear` : 'none' }}>
        <div
          className={cx('agent-scene__char', !walking && `pose--${view.pose}`, walking && 'is-walking')}
          style={{ height: `${h * 100}%`, bottom: `${spot.bottom}%` }}
        >
          <img src={src} alt="" draggable={false} style={{ transform: walking && dir === -1 ? 'scaleX(-1)' : undefined }} />
          {showBubble && <img className="agent-scene__bubble" src={bubbleSrc(view.bubble!)} alt="" draggable={false} />}
        </div>
      </div>
    </div>
      {/* 상태 메시지는 장면 아래에 둬서 캐릭터를 가리지 않는다 */}
      {size === 'large' ? (
        <div className="agent-scene__status">
          <span className="agent-scene__place">{PLACE_LABEL[shown]}</span>
          <span className="agent-scene__label title-font">{view.label}</span>
          {(view.detail || view.until) && (
            <span className="agent-scene__detail">
              {view.detail}
              {view.until ? ` · ~${view.until}` : ''}
            </span>
          )}
        </div>
      ) : (
        <span className="agent-scene__mini-label">{view.label}</span>
      )}
    </div>
  );
}
