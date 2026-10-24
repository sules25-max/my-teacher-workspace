// 앱 전체가 공유하는 데이터 모델.
// 모든 동기화 레코드는 BaseRecord를 확장하고 UUID를 id로 사용한다.

export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckItem {
  id: string;
  text: string;
  done: boolean;
}

/** 시간표의 한 교시 슬롯. grades가 있으면 해당 학년만 그 슬롯에 배정된다. */
export interface PeriodSlot {
  id: string;
  label: string; // "4교시 (3·5·6학년)"
  short: string; // "4교시"
  grades?: number[];
  start?: string; // "11:50"
  end?: string;
}

export interface CurriculumLesson {
  id: string;
  name: string; // "Lesson 8"
  title?: string; // "What time is it?"
  sessions: number;
}

export type CategoryId = 'lesson' | 'event' | 'work' | 'training' | 'deadline' | 'personal';

export interface Category {
  id: CategoryId;
  label: string;
  color: string;
}

export interface Semester {
  id: string;
  label: string;
  start: string;
  end: string;
}

export type AIProviderId = 'local' | 'groq' | 'gemini' | 'openai';

export interface Settings {
  id: 'main';
  setupDone: boolean;
  displayName: string;
  schoolName: string;
  subject: string;
  academicYear: number;
  weekdays: number[]; // 1=월 ... 5=금 (6=토)
  periods: PeriodSlot[];
  grades: number[];
  classesPerGrade: Record<string, number>; // "3" -> 4
  totalSessions: number;
  curriculum: Record<string, CurriculumLesson[]>; // grade -> lessons
  /** `${weekday}:${periodId}` -> classKey("3-1") */
  timetable: Record<string, string>;
  semesters: Semester[];
  categories: Category[];
  sync: {
    mode: 'local' | 'appsScript';
    endpoint: string;
    token: string; // 사용자가 직접 입력. 코드에 하드코딩하지 않음
    autoSync: boolean;
    lastSyncAt?: string;
  };
  ai: {
    provider: AIProviderId;
    model?: string;
    confirmContext: boolean; // 외부 전송 전 보낼 정보 미리보기
  };
  weather: { enabled: boolean; lat: number; lon: number; label: string };
  neis: { enabled: boolean; apiKey: string; officeCode: string; schoolCode: string };
  assistant: { visible: boolean };
  updatedAt: string;
}

export interface LessonRecord extends BaseRecord {
  date: string; // YYYY-MM-DD
  weekday: number;
  periodId: string;
  period: number; // 표시 순서(1부터)
  grade: number;
  classNumber: number;
  classKey: string; // "3-2"
  lessonId?: string;
  lesson: string;
  session: number;
  totalSessions?: number;
  objective?: string;
  activities: CheckItem[];
  materials: CheckItem[];
  memo?: string;
  completed: boolean;
  completedAt?: string;
  attachments: string[];
  copiedFrom?: string;
}

/** 진도표의 한 칸: 특정 반이 특정 Lesson의 특정 차시를 마쳤다는 기록. */
export interface ProgressEntry extends BaseRecord {
  classKey: string;
  grade: number;
  lessonId: string;
  lesson: string;
  session: number;
  date: string;
  lessonRecordId?: string;
  source: 'lesson' | 'manual' | 'assistant';
}

export interface CalendarEvent extends BaseRecord {
  date: string;
  endDate?: string;
  time?: string;
  title: string;
  category: CategoryId;
  memo?: string;
  attachments: string[];
  gcalEventId?: string;
}

export interface Task extends BaseRecord {
  title: string;
  completed: boolean;
  completedAt?: string;
  dueDate?: string;
  important?: boolean;
  sourceType?: 'meeting' | 'lesson' | 'page' | 'assistant' | 'event';
  sourceId?: string;
  sourceLabel?: string;
}

/** quick: 빠른 메모 · day: 날짜 메모 · summary: 하루 정리(저장한 것) · inbox: AI Inbox(AI 분석 결과를 사용자가 저장) */
export type NoteKind = 'quick' | 'day' | 'summary' | 'inbox';

/** 빠른 메모, 월간 날짜별 메모 */
export interface Note extends BaseRecord {
  kind: NoteKind;
  date: string;
  text: string;
  title?: string;
  inkDocId?: string;
  attachments: string[];
}

export type MeetingKind = '부장회의' | '교직원회의' | '업무회의' | '학년회의' | '기타';

export interface MeetingNote extends BaseRecord {
  title: string;
  kind: MeetingKind;
  date: string;
  announcements: string;
  decisions: string;
  todos: string;
  memo: string;
  attachments: string[];
  inkDocId?: string;
  archived?: boolean;
}

export type PageTemplate =
  | 'blank'
  | 'lined'
  | 'grid'
  | 'dot'
  | 'meeting'
  | 'weekly'
  | 'monthly'
  | 'checklist'
  | 'lesson'
  | 'board';

export type PageBlock =
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'text'; text: string; label?: string }
  | { id: string; type: 'checklist'; items: CheckItem[]; label?: string }
  | { id: string; type: 'ink'; docId: string };

export interface PageGroup extends BaseRecord {
  name: string;
  order: number;
}

export interface WorkspacePage extends BaseRecord {
  title: string;
  template: PageTemplate;
  groupId?: string;
  order: number;
  blocks: PageBlock[];
  archived?: boolean;
}

export type InkBackground = 'plain' | 'lined' | 'grid' | 'dot';

export interface InkPoint {
  x: number;
  y: number;
  pressure: number;
}

export interface Stroke {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  points: InkPoint[];
}

export interface InkImage {
  id: string;
  attachmentId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 손글씨 문서. 다시 편집할 수 있도록 stroke 자체를 JSON으로 보관한다. */
export interface InkDoc extends BaseRecord {
  width: number;
  height: number;
  background: InkBackground;
  strokes: Stroke[];
  images: InkImage[];
  preview?: string; // 썸네일용 작은 PNG dataURL
}

export type AttachmentKind = 'photo' | 'file' | 'link' | 'ink';

export interface Attachment extends BaseRecord {
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  blob?: Blob; // 로컬에만 보관. 동기화 시 Drive로 업로드
  url?: string; // link
  inkDocId?: string;
  driveFileId?: string;
  ownerType?: string;
  ownerId?: string;
}

/** 특정 날짜의 칸만 정기 시간표와 다르게: 반 변경(classKey) 또는 휴강(null) */
export interface SlotOverride extends BaseRecord {
  date: string;
  periodId: string;
  classKey: string | null;
  note?: string;
  /** 변경 종류(선택): change 반 바꾸기 · cancel 휴강 · substitute 보결 · move 다른 칸으로 옮김 */
  kind?: 'change' | 'cancel' | 'substitute' | 'move';
}

export type SyncTable =
  | 'slotOverrides'
  | 'lessons'
  | 'progress'
  | 'events'
  | 'tasks'
  | 'notes'
  | 'meetings'
  | 'pages'
  | 'pageGroups'
  | 'inkDocs'
  | 'attachments';

export interface SyncQueueItem {
  key: string; // `${table}:${recordId}`
  table: SyncTable | 'settings';
  recordId: string;
  op: 'upsert' | 'delete';
  at: string;
  tries: number;
}

export interface Tombstone {
  key: string;
  table: SyncTable;
  recordId: string;
  deletedAt: string;
}
