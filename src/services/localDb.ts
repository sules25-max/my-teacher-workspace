import Dexie, { type Table } from 'dexie';
import type {
  Attachment,
  CalendarEvent,
  InkDoc,
  LessonRecord,
  MeetingNote,
  Note,
  PageGroup,
  ProgressEntry,
  Settings,
  SyncQueueItem,
  Task,
  Tombstone,
  WorkspacePage,
} from '../types';

/** 모든 데이터는 먼저 기기 안의 IndexedDB에 저장된다(local-first). */
export class WorkspaceDB extends Dexie {
  settings!: Table<Settings, string>;
  lessons!: Table<LessonRecord, string>;
  progress!: Table<ProgressEntry, string>;
  events!: Table<CalendarEvent, string>;
  tasks!: Table<Task, string>;
  notes!: Table<Note, string>;
  meetings!: Table<MeetingNote, string>;
  pages!: Table<WorkspacePage, string>;
  pageGroups!: Table<PageGroup, string>;
  inkDocs!: Table<InkDoc, string>;
  attachments!: Table<Attachment, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  tombstones!: Table<Tombstone, string>;

  constructor() {
    super('my-teacher-workspace');
    this.version(1).stores({
      settings: 'id',
      lessons: 'id, date, classKey, [date+periodId], grade, updatedAt',
      progress: 'id, classKey, grade, lessonRecordId, [classKey+lessonId+session]',
      events: 'id, date, category, updatedAt',
      tasks: 'id, dueDate, completed, sourceId, updatedAt',
      notes: 'id, kind, date, updatedAt',
      meetings: 'id, date, updatedAt',
      pages: 'id, groupId, order, template, updatedAt',
      pageGroups: 'id, order',
      inkDocs: 'id, updatedAt',
      attachments: 'id, ownerId, updatedAt',
      syncQueue: 'key, at',
      tombstones: 'key',
    });
  }
}

export const db = new WorkspaceDB();

/** 저장 공간이 브라우저에 의해 정리되지 않도록 영구 저장을 요청한다(iOS 홈 화면 앱에서 특히 중요). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* 지원하지 않는 환경 */
  }
  return false;
}
