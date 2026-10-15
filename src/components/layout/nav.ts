import {
  Archive,
  CalendarDays,
  CalendarRange,
  CheckSquare,
  ClipboardList,
  Home,
  NotebookPen,
  PenTool,
  Settings as SettingsIcon,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  route: string;
  label: string;
  ko: string;
  icon: LucideIcon;
  mobile?: boolean;
}

export const NAV: NavItem[] = [
  { route: 'today', label: 'Today', ko: '오늘', icon: Home, mobile: true },
  { route: 'week', label: 'Weekly', ko: '주간 수업', icon: CalendarRange, mobile: true },
  { route: 'month', label: 'Monthly', ko: '월간 일정', icon: CalendarDays },
  { route: 'progress', label: 'Progress', ko: '진도표', icon: TrendingUp },
  { route: 'work', label: 'Work', ko: '회의 · 업무', icon: ClipboardList },
  { route: 'board', label: 'Board', ko: '자유보드', icon: PenTool },
  { route: 'pages', label: 'Pages', ko: '페이지', icon: NotebookPen, mobile: true },
  { route: 'tasks', label: 'Tasks', ko: '할 일', icon: CheckSquare, mobile: true },
  { route: 'archive', label: 'Archive', ko: '보관함', icon: Archive },
];

export const SETTINGS_NAV: NavItem = { route: 'settings', label: 'Settings', ko: '설정', icon: SettingsIcon };

export function titleFor(route: string): NavItem {
  return [...NAV, SETTINGS_NAV].find((n) => n.route === route) ?? NAV[0];
}
