import type { CalendarEvent, LessonRecord, Settings } from '../../types';
import { effectiveSlot, type OverrideMap } from '../planner';
import { isoWeekday, toISODate } from '../../utils/date';
import { holidayName } from '../../data/holidays';

// AI 이나의 하루: 시간표 · 일정 · 시계를 보고 지금 어디서 무엇을 하는지 정한다(다마고치처럼).

export type Place = 'classroom' | 'staffroom' | 'lounge' | 'meeting' | 'library' | 'hallway';
export type PoseId = 'idle' | 'joy' | 'talk' | 'think' | 'work' | 'teach' | 'meeting' | 'sit' | 'rest' | 'doze' | 'surprised' | 'walk-away';
export type Activity = 'teaching' | 'meeting' | 'break' | 'lunch' | 'working' | 'arrived' | 'commute' | 'night' | 'dayoff';

export interface AgentStatus {
  activity: Activity;
  place: Place;
  pose: PoseId;
  label: string; // "3-1 수업 중"
  detail?: string; // "Lesson 8 · 3차시"
  until?: string; // "10:30"
  wander: boolean; // 방 안을 돌아다녀도 되는 상태인지
}

export const PLACE_LABEL: Record<Place, string> = {
  classroom: '교실',
  staffroom: '교무실',
  lounge: '휴게실',
  meeting: '회의실',
  library: '자료실',
  hallway: '복도',
};

const toMin = (hm?: string) => {
  if (!hm) return NaN;
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const MEETING_RE = /(회의|협의|연수|위원회|미팅|간담회|설명회)/;

export interface StatusInput {
  now: Date;
  settings: Settings;
  lessons: LessonRecord[]; // 오늘 수업 기록
  events: CalendarEvent[]; // 오늘 일정
  overrides?: OverrideMap; // 오늘 시간표 변경
}

export function computeStatus({ now, settings: s, lessons, events, overrides }: StatusInput): AgentStatus {
  const date = toISODate(now);
  const t = now.getHours() * 60 + now.getMinutes();
  const hol = holidayName(date);

  if (!s.weekdays.includes(isoWeekday(date)) || hol) {
    return { activity: 'dayoff', place: 'lounge', pose: 'rest', label: hol ? `${hol} · 쉬는 날` : '주말 · 쉬는 날', wander: true };
  }
  if (t < 7 * 60 + 30 || t >= 19 * 60) {
    return { activity: 'night', place: 'lounge', pose: 'doze', label: '퇴근 후 쉬는 중', detail: '내일 봐요 zzz', wander: false };
  }

  // 회의: 시간이 있는 일정 중 회의·협의·연수 (시작 5분 전 ~ 1시간)
  for (const e of events) {
    const st = toMin(e.time);
    if (Number.isNaN(st)) continue;
    if ((MEETING_RE.test(e.title) || e.category === 'training') && t >= st - 5 && t < st + 60) {
      return { activity: 'meeting', place: 'meeting', pose: 'meeting', label: '회의 중', detail: e.title, until: toHM(st + 60), wander: false };
    }
  }

  const periods = s.periods
    .map((p) => ({ p, start: toMin(p.start), end: toMin(p.end) }))
    .filter((x) => !Number.isNaN(x.start) && !Number.isNaN(x.end))
    .sort((a, b) => a.start - b.start);
  const classOf = (periodId: string) => lessons.find((r) => r.periodId === periodId)?.classKey ?? effectiveSlot(s, date, periodId, overrides).classKey;
  const teaching = periods.filter((x) => classOf(x.p.id));

  // 수업 중
  for (const x of teaching) {
    if (t >= x.start && t < x.end) {
      const cls = classOf(x.p.id)!;
      const rec = lessons.find((r) => r.periodId === x.p.id);
      return {
        activity: 'teaching',
        place: 'classroom',
        pose: 'teach',
        label: `${cls} 수업 중`,
        detail: rec?.lesson ? `${rec.lesson} · ${rec.session}차시` : x.p.short,
        until: x.p.end,
        wander: false,
      };
    }
  }

  const firstStart = periods[0]?.start ?? 9 * 60;
  const lastEnd = periods.length ? Math.max(...periods.map((x) => x.end)) : 15 * 60 + 20;
  const nextLesson = teaching.find((x) => x.start > t);
  const nextLabel = nextLesson ? `다음: ${nextLesson.p.short} ${classOf(nextLesson.p.id)} (${nextLesson.p.start})` : undefined;

  if (t < firstStart) {
    return { activity: 'arrived', place: 'staffroom', pose: 'idle', label: '출근 완료', detail: nextLabel ?? '오늘은 수업이 없어요', wander: true };
  }

  if (t < lastEnd) {
    // 지금이 어떤 교시 안인지 (수업 없는 교시 = 공강)
    const inPeriod = periods.find((x) => t >= x.start && t < x.end);
    if (inPeriod) {
      return { activity: 'working', place: 'staffroom', pose: 'work', label: '공강 · 업무 중', detail: nextLabel, until: inPeriod.p.end, wander: false };
    }
    // 교시 사이: 30분 이상 비면 점심, 아니면 쉬는 시간
    const prevEnd = Math.max(...periods.filter((x) => x.end <= t).map((x) => x.end), firstStart);
    const nextStart = Math.min(...periods.filter((x) => x.start > t).map((x) => x.start), lastEnd);
    if (nextStart - prevEnd >= 30) {
      return { activity: 'lunch', place: 'lounge', pose: 'rest', label: '점심시간', detail: nextLabel, until: toHM(nextStart), wander: true };
    }
    return { activity: 'break', place: 'lounge', pose: 'sit', label: '쉬는 시간', detail: nextLabel, until: toHM(nextStart), wander: true };
  }

  if (t < 17 * 60) {
    return { activity: 'working', place: 'staffroom', pose: 'work', label: '업무 중', detail: '수업 끝! 남은 일 정리 중', until: '17:00', wander: false };
  }
  return { activity: 'commute', place: 'hallway', pose: 'walk-away', label: '퇴근하는 중', detail: '오늘도 수고했어요', wander: false };
}
