// 날짜는 항상 로컬 기준 YYYY-MM-DD 문자열로 다룬다.

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function addMonths(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return toISODate(d);
}

/** 1=월 ... 7=일 */
export function isoWeekday(iso: string): number {
  const w = parseISODate(iso).getDay();
  return w === 0 ? 7 : w;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

export function dateOfWeekday(weekStart: string, weekday: number): string {
  return addDays(weekStart, weekday - 1);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseISODate(a).getTime() - parseISODate(b).getTime()) / 86400000);
}

const EN_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const KO_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const WEEKDAY_KO = ['', '월', '화', '수', '목', '금', '토', '일'];

export function formatEn(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getFullYear()}. ${pad(d.getMonth() + 1)}. ${pad(d.getDate())} ${EN_DAYS[d.getDay()]}`;
}

export function formatKo(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${KO_DAYS[d.getDay()]}요일`;
}

export function formatShort(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getMonth() + 1}/${d.getDate()} (${KO_DAYS[d.getDay()]})`;
}

export function formatMonthDay(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'GOOD NIGHT';
  if (h < 12) return 'GOOD MORNING';
  if (h < 18) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

export function monthMatrix(year: number, month0: number): string[][] {
  // 일요일 시작 6주 달력
  const first = new Date(year, month0, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: string[] = [];
    for (let i = 0; i < 7; i++) {
      row.push(toISODate(start));
      start.setDate(start.getDate() + 1);
    }
    weeks.push(row);
  }
  if (parseISODate(weeks[5][0]).getMonth() !== month0) weeks.pop();
  return weeks;
}

export function relativeDue(iso: string, today = todayISO()): string {
  const d = diffDays(iso, today);
  if (d === 0) return '오늘';
  if (d === 1) return '내일';
  if (d === -1) return '어제';
  if (d < 0) return `${-d}일 지남`;
  if (d < 7) return `${d}일 후`;
  return formatMonthDay(iso);
}

/**
 * 문장 속 날짜 표현을 찾아 ISO 날짜로 바꾼다.
 * "10월 22일까지", "10/22", "22일까지", "내일", "모레", "금요일까지"
 */
export function extractDate(text: string, base = todayISO()): { date?: string; rest: string } {
  const baseDate = parseISODate(base);
  const year = baseDate.getFullYear();
  const pick = (m: number, d: number) => {
    let iso = toISODate(new Date(year, m - 1, d));
    if (diffDays(iso, base) < -60) iso = toISODate(new Date(year + 1, m - 1, d));
    return iso;
  };
  const patterns: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/(\d{1,2})\s*월\s*(\d{1,2})\s*일(\s*\([^)]*\))?(\s*까지)?/, (m) => pick(+m[1], +m[2])],
    [/(?<![\d.])(\d{1,2})[/.](\d{1,2})(?![\d.])(\s*\([^)]*\))?(\s*까지)?/, (m) => pick(+m[1], +m[2])],
    [/(?<!\d)(\d{1,2})\s*일(\s*까지)/, (m) => pick(baseDate.getMonth() + 1, +m[1])],
    [/내일(\s*까지)?/, () => addDays(base, 1)],
    [/모레(\s*까지)?/, () => addDays(base, 2)],
    [/오늘(\s*중|\s*까지)?/, () => base],
    [/(이번\s*주\s*)?([월화수목금토일])요일(\s*까지)?/, (m) => {
      const target = '월화수목금토일'.indexOf(m[2]) + 1;
      let diff = target - isoWeekday(base);
      if (diff < 0) diff += 7;
      return addDays(base, diff);
    }],
  ];
  for (const [re, fn] of patterns) {
    const m = text.match(re);
    if (m) {
      const rest = text.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim();
      return { date: fn(m), rest };
    }
  }
  return { rest: text.trim() };
}
