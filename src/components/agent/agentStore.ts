import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/localDb';
import { loadOverrides } from '../../services/planner';
import { computeStatus, type AgentStatus, type Place, type PoseId } from '../../services/agent/status';
import { useSettingsLoaded } from '../../hooks/useData';
import { createDefaultSettings } from '../../data/defaults';
import { toISODate } from '../../utils/date';

// AI 이나의 짧은 반응(AI 호출 · 답변 · 오류 등)과 사용자 활동 시간을 관리한다.

export type ReactionKind = 'thinking' | 'answer' | 'error' | 'search' | 'found' | 'done' | 'talk' | 'greet';
export type BubbleId = 'dots' | 'heart' | 'sparkle' | 'question' | 'bang';

interface Reaction {
  kind: ReactionKind;
  until: number;
}

const DEFAULT_MS: Record<ReactionKind, number> = {
  thinking: 20000,
  answer: 4500,
  error: 4500,
  search: 7000,
  found: 9000, // 자료실까지 걸어가서 찾은 뒤 기뻐하는 시간
  done: 4000,
  talk: 6000,
  greet: 2500,
};

let reaction: Reaction | null = null;
const listeners = new Set<() => void>();
let clearTimer: ReturnType<typeof setTimeout> | undefined;
const emit = () => listeners.forEach((l) => l());

/** 예: react('thinking') → AI 호출 중 / react('answer') → 답변 완료 */
export function react(kind: ReactionKind, ms = DEFAULT_MS[kind]) {
  reaction = { kind, until: Date.now() + ms };
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    reaction = null;
    emit();
  }, ms);
  emit();
}

export function useAgentReaction(): Reaction | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => reaction,
  );
}

// ---------- 사용자 활동(오래 안 쓰면 꾸벅꾸벅) ----------
let lastActive = Date.now();
if (typeof window !== 'undefined') {
  const mark = () => (lastActive = Date.now());
  ['pointerdown', 'keydown', 'wheel'].forEach((e) => window.addEventListener(e, mark, { passive: true }));
}

/** 개발·확인용: localStorage 'mtw.agent.time' = "10:05" 처럼 넣으면 그 시각으로 본다 */
function agentNow(): Date {
  try {
    const hm = localStorage.getItem('mtw.agent.time');
    if (hm && /^\d{1,2}:\d{2}$/.test(hm)) {
      const d = new Date();
      const [h, m] = hm.split(':').map(Number);
      d.setHours(h, m, 0, 0);
      return d;
    }
  } catch {
    /* 무시 */
  }
  return new Date();
}

export interface AgentView extends AgentStatus {
  bubble?: BubbleId;
  reacting: boolean;
  ready: boolean; // 설정 · 오늘 수업 · 일정을 다 읽었는지 (읽기 전에는 이동 애니메이션을 하지 않는다)
}

const REACTION_VIEW: Record<ReactionKind, { pose: PoseId; bubble?: BubbleId; label: string; place?: Place }> = {
  thinking: { pose: 'think', label: '생각 중…' },
  answer: { pose: 'joy', bubble: 'sparkle', label: '답을 찾았어!' },
  error: { pose: 'surprised', label: '앗, 문제가 생겼어' },
  search: { pose: 'think', bubble: 'dots', label: '자료 찾는 중', place: 'library' },
  found: { pose: 'joy', bubble: 'sparkle', label: '찾았어!', place: 'library' },
  done: { pose: 'joy', bubble: 'heart', label: '반영 완료!' },
  talk: { pose: 'talk', label: '듣고 있어' },
  greet: { pose: 'joy', bubble: 'heart', label: '안녕!' },
};

export function useAgentView(): AgentView {
  const loaded = useSettingsLoaded();
  const s = useMemo(() => loaded ?? createDefaultSettings(), [loaded]);
  const [now, setNow] = useState(agentNow);
  useEffect(() => {
    const t = setInterval(() => setNow(agentNow()), 20000);
    return () => clearInterval(t);
  }, []);
  const today = toISODate(now);
  const lessons = useLiveQuery(() => db.lessons.where('date').equals(today).toArray(), [today]);
  const events = useLiveQuery(() => db.events.where('date').equals(today).toArray(), [today]);
  const overrides = useLiveQuery(() => loadOverrides(today, today), [today]);
  const r = useAgentReaction();

  const status = useMemo(
    () => computeStatus({ now, settings: s, lessons: lessons ?? [], events: events ?? [], overrides }),
    [now, s, lessons, events, overrides],
  );

  const ready = !!loaded && lessons !== undefined && events !== undefined && overrides !== undefined;
  if (r) {
    const v = REACTION_VIEW[r.kind];
    return { ...status, pose: v.pose, bubble: v.bubble, label: v.label, detail: status.label, place: v.place ?? status.place, wander: false, reacting: true, ready };
  }
  const idleMin = (now.getTime() - lastActive) / 60000;
  if (idleMin >= 20 && (status.activity === 'arrived' || status.activity === 'working' || status.activity === 'break')) {
    return { ...status, pose: 'doze', label: '꾸벅꾸벅…', detail: status.label, wander: false, reacting: false, ready };
  }
  return { ...status, reacting: false, ready };
}
