import type { Settings } from '../../types';

// NEIS 교육정보 개방 포털 API (선택 기능). 키가 없으면 DisabledNeisService가 빈 결과를 돌려준다.

export interface SchoolScheduleItem {
  date: string;
  name: string;
}

export interface MealInfo {
  date: string;
  dishes: string[];
}

export interface NeisService {
  readonly enabled: boolean;
  schedule(from: string, to: string): Promise<SchoolScheduleItem[]>;
  meal(date: string): Promise<MealInfo | null>;
}

const ymd = (iso: string) => iso.replaceAll('-', '');
const iso = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;

class NeisApiService implements NeisService {
  readonly enabled = true;
  constructor(private cfg: Settings['neis']) {}
  private async get<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const q = new URLSearchParams({
      KEY: this.cfg.apiKey,
      Type: 'json',
      pIndex: '1',
      pSize: '200',
      ATPT_OFCDC_SC_CODE: this.cfg.officeCode,
      SD_SCHUL_CODE: this.cfg.schoolCode,
      ...params,
    });
    const res = await fetch(`https://open.neis.go.kr/hub/${path}?${q}`);
    if (!res.ok) return [];
    const j = (await res.json()) as Record<string, [unknown, { row: T[] }]>;
    return j[path]?.[1]?.row ?? [];
  }
  async schedule(from: string, to: string) {
    const rows = await this.get<{ AA_YMD: string; EVENT_NM: string }>('SchoolSchedule', { AA_FROM_YMD: ymd(from), AA_TO_YMD: ymd(to) });
    return rows.filter((r) => r.EVENT_NM !== '토요휴업일').map((r) => ({ date: iso(r.AA_YMD), name: r.EVENT_NM }));
  }
  async meal(date: string) {
    const rows = await this.get<{ MLSV_YMD: string; DDISH_NM: string }>('mealServiceDietInfo', { MLSV_YMD: ymd(date) });
    if (!rows[0]) return null;
    return { date, dishes: rows[0].DDISH_NM.split('<br/>').map((d) => d.replace(/\([\d.]+\)/g, '').trim()) };
  }
}

const disabled: NeisService = {
  enabled: false,
  async schedule() {
    return [];
  },
  async meal() {
    return null;
  },
};

export function getNeisService(s: Settings): NeisService {
  const c = s.neis;
  if (!c.enabled || !c.apiKey || !c.officeCode || !c.schoolCode) return disabled;
  return new NeisApiService(c);
}
