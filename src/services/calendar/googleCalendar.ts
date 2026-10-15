import type { CalendarEvent } from '../../types';
import { callAppsScript, getAppsScriptConfig } from '../google/appsScriptClient';

/** 사용자가 고른 일정만 Google Calendar로 보낸다. 자동 전송은 하지 않는다. */
export interface CalendarAdapter {
  isAvailable(): Promise<boolean>;
  pushEvent(e: CalendarEvent): Promise<{ eventId: string }>;
}

export const appsScriptCalendar: CalendarAdapter = {
  async isAvailable() {
    return !!(await getAppsScriptConfig());
  },
  async pushEvent(e) {
    return callAppsScript<{ eventId: string }>('calendarCreateEvent', {
      id: e.id,
      title: e.title,
      date: e.date,
      endDate: e.endDate,
      time: e.time,
      description: e.memo ?? '',
      eventId: e.gcalEventId,
    });
  },
};
