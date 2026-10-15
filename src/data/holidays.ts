// 한국 공휴일 로컬 데이터(대체공휴일 포함). 다른 연도는 HolidayProvider를 확장해 API로 받아올 수 있다.
// 정부 발표에 따라 바뀔 수 있으니 매년 확인이 필요하다.

export interface Holiday {
  date: string;
  name: string;
}

const DATA: Record<number, Holiday[]> = {
  2026: [
    { date: '2026-01-01', name: '신정' },
    { date: '2026-02-16', name: '설날 연휴' },
    { date: '2026-02-17', name: '설날' },
    { date: '2026-02-18', name: '설날 연휴' },
    { date: '2026-03-01', name: '삼일절' },
    { date: '2026-03-02', name: '대체공휴일' },
    { date: '2026-05-05', name: '어린이날' },
    { date: '2026-05-24', name: '부처님오신날' },
    { date: '2026-05-25', name: '대체공휴일' },
    { date: '2026-06-03', name: '지방선거' },
    { date: '2026-06-06', name: '현충일' },
    { date: '2026-08-15', name: '광복절' },
    { date: '2026-08-17', name: '대체공휴일' },
    { date: '2026-09-24', name: '추석 연휴' },
    { date: '2026-09-25', name: '추석' },
    { date: '2026-09-26', name: '추석 연휴' },
    { date: '2026-10-03', name: '개천절' },
    { date: '2026-10-05', name: '대체공휴일' },
    { date: '2026-10-09', name: '한글날' },
    { date: '2026-12-25', name: '성탄절' },
  ],
  2027: [
    { date: '2027-01-01', name: '신정' },
    { date: '2027-02-06', name: '설날 연휴' },
    { date: '2027-02-07', name: '설날' },
    { date: '2027-02-08', name: '설날 연휴' },
    { date: '2027-02-09', name: '대체공휴일' },
    { date: '2027-03-01', name: '삼일절' },
    { date: '2027-05-05', name: '어린이날' },
    { date: '2027-05-13', name: '부처님오신날' },
    { date: '2027-06-06', name: '현충일' },
    { date: '2027-08-15', name: '광복절' },
    { date: '2027-08-16', name: '대체공휴일' },
    { date: '2027-09-14', name: '추석 연휴' },
    { date: '2027-09-15', name: '추석' },
    { date: '2027-09-16', name: '추석 연휴' },
    { date: '2027-10-03', name: '개천절' },
    { date: '2027-10-04', name: '대체공휴일' },
    { date: '2027-10-09', name: '한글날' },
    { date: '2027-10-11', name: '대체공휴일' },
    { date: '2027-12-25', name: '성탄절' },
    { date: '2027-12-27', name: '대체공휴일' },
  ],
};

const FIXED: [string, string][] = [
  ['01-01', '신정'],
  ['03-01', '삼일절'],
  ['05-05', '어린이날'],
  ['06-06', '현충일'],
  ['08-15', '광복절'],
  ['10-03', '개천절'],
  ['10-09', '한글날'],
  ['12-25', '성탄절'],
];

export interface HolidayProvider {
  forYear(year: number): Holiday[];
}

export const localHolidayProvider: HolidayProvider = {
  forYear(year) {
    // 데이터가 없는 연도는 양력 고정 공휴일만 표시한다.
    return DATA[year] ?? FIXED.map(([md, name]) => ({ date: `${year}-${md}`, name }));
  },
};

const cache = new Map<string, string>();
export function holidayName(iso: string): string | undefined {
  const year = Number(iso.slice(0, 4));
  if (!cache.has(`y${year}`)) {
    for (const h of localHolidayProvider.forYear(year)) cache.set(h.date, h.name);
    cache.set(`y${year}`, '1');
  }
  return cache.get(iso);
}
