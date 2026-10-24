import { useEffect, useState, type ReactElement } from 'react';
import { useRoute } from './hooks/useRoute';
import { ensureSettings, useSettingsLoaded } from './hooks/useData';
import { AppShell } from './components/layout/AppShell';
import { SetupWizard } from './components/layout/SetupWizard';
import { ConnectPage } from './components/layout/ConnectPage';
import { DialogHost, ToastHost } from './components/common/overlays';
import { SearchPalette } from './components/common/SearchPalette';
import { LessonDrawerHost } from './components/planner/LessonDrawer';
import { DailySummaryHost } from './components/assistant/DailySummary';
import { AssistantFloatingButton } from './components/assistant/AssistantFloatingButton';
import { TodayPage } from './pages/TodayPage';
import { WeekPage } from './pages/WeekPage';
import { MonthPage } from './pages/MonthPage';
import { ProgressPage } from './pages/ProgressPage';
import { WorkPage } from './pages/WorkPage';
import { BoardPage } from './pages/BoardPage';
import { PagesPage } from './pages/PagesPage';
import { TasksPage } from './pages/TasksPage';
import { ArchivePage } from './pages/ArchivePage';
import { SettingsPage } from './pages/SettingsPage';
import { startSyncEngine } from './services/sync/syncEngine';
import { requestPersistence } from './services/localDb';

const PAGES: Record<string, () => ReactElement | null> = {
  today: TodayPage,
  week: WeekPage,
  month: MonthPage,
  progress: ProgressPage,
  work: WorkPage,
  board: BoardPage,
  pages: PagesPage,
  tasks: TasksPage,
  archive: ArchivePage,
  settings: SettingsPage,
};

export function App() {
  const settings = useSettingsLoaded();
  const route = useRoute();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    void ensureSettings().then(startSyncEngine);
    // 브라우저가 공간 부족 시 데이터를 지우지 않도록 영구 저장을 요청한다(이미 허용됐으면 그대로)
    void requestPersistence();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.getElementById('main')?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  }, [route.name]);

  if (settings === undefined || settings === null) return <div className="boot" aria-busy="true" />;
  // 연결 링크는 설정 마법사보다 먼저: 새 기기도 링크 하나로 기존 수첩을 불러온다
  if (route.name === 'connect') return <ConnectPage code={route.params[0] ?? ''} />;
  if (!settings.setupDone) return <SetupWizard initial={settings} />;

  const Page = PAGES[route.name] ?? TodayPage;
  return (
    <>
      <AppShell onSearch={() => setSearchOpen(true)}>
        <Page />
      </AppShell>
      <LessonDrawerHost />
      <DailySummaryHost />
      <AssistantFloatingButton />
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <DialogHost />
      <ToastHost />
    </>
  );
}
