import type { Category, CurriculumLesson, PeriodSlot, Settings } from '../types';
import { nowISO } from '../utils/id';

/** 기본 교시: 4교시는 학년군별로 시간이 달라 두 슬롯으로 나눈다. */
export const DEFAULT_PERIODS: PeriodSlot[] = [
  { id: 'p1', label: '1교시', short: '1교시', start: '09:00', end: '09:40' },
  { id: 'p2', label: '2교시', short: '2교시', start: '09:50', end: '10:30' },
  { id: 'p3', label: '3교시', short: '3교시', start: '10:50', end: '11:30' },
  { id: 'p4a', label: '4교시 (3·5·6학년)', short: '4교시', grades: [3, 5, 6], start: '11:40', end: '12:20' },
  { id: 'p4b', label: '4교시 (1·2·4학년)', short: '4교시', grades: [1, 2, 4], start: '12:30', end: '13:10' },
  { id: 'p5', label: '5교시', short: '5교시', start: '13:50', end: '14:30' },
  { id: 'p6', label: '6교시', short: '6교시', start: '14:40', end: '15:20' },
];

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'lesson', label: '수업', color: '#82B7D9' },
  { id: 'event', label: '학교행사', color: '#FFAD32' },
  { id: 'work', label: '업무', color: '#FF6680' },
  { id: 'training', label: '연수', color: '#8A8FE0' },
  { id: 'deadline', label: '마감', color: '#F2765A' },
  { id: 'personal', label: '개인', color: '#9AA9B5' },
];

/** 34차시 기본 커리큘럼: Lesson 1~8 × 4차시 + 복습 2차시 */
export function defaultCurriculum(total = 34): CurriculumLesson[] {
  const lessons: CurriculumLesson[] = [];
  let remaining = total;
  let n = 1;
  while (remaining > 0) {
    const sessions = remaining >= 4 && n <= 8 ? 4 : remaining;
    lessons.push({ id: `L${n}`, name: n <= 8 ? `Lesson ${n}` : 'Review', sessions });
    remaining -= sessions;
    n++;
  }
  return lessons;
}

export function createDefaultSettings(): Settings {
  const year = new Date().getFullYear();
  return {
    id: 'main',
    setupDone: false,
    displayName: '선생님',
    schoolName: '',
    subject: '영어',
    academicYear: year,
    weekdays: [1, 2, 3, 4, 5],
    periods: DEFAULT_PERIODS,
    grades: [3, 4],
    classesPerGrade: { '3': 4, '4': 4 },
    totalSessions: 34,
    curriculum: { '3': defaultCurriculum(34), '4': defaultCurriculum(34) },
    timetable: {},
    semesters: [
      { id: `${year}-1`, label: `${year} 1학기`, start: `${year}-03-01`, end: `${year}-08-15` },
      { id: `${year}-2`, label: `${year} 2학기`, start: `${year}-08-16`, end: `${year + 1}-02-28` },
    ],
    categories: DEFAULT_CATEGORIES,
    sync: { mode: 'local', endpoint: '', token: '', autoSync: true },
    ai: { provider: 'local', confirmContext: true },
    weather: { enabled: true, lat: 37.5665, lon: 126.978, label: '서울' },
    neis: { enabled: false, apiKey: '', officeCode: '', schoolCode: '' },
    assistant: { visible: true },
    updatedAt: nowISO(),
  };
}

export const ACTIVITY_PRESETS = ['PPT', 'Song & Chant', 'Speaking Game', 'Worksheet', 'Role-play', 'Phonics'];
export const MATERIAL_PRESETS = ['활동지', '카드', '보상 스티커', '태블릿'];
