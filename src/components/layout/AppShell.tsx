import { useEffect, useState, type ReactNode } from 'react';
import { Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { NAV, SETTINGS_NAV, titleFor } from './nav';
import { navigate, useRoute } from '../../hooks/useRoute';
import { SyncIndicator } from './SyncIndicator';
import { PixelIcon } from '../common/Deco';
import { cx } from '../../utils/id';
import { Drawer } from '../common/overlays';

interface Props {
  children: ReactNode;
  onSearch: () => void;
}

function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('mtw.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('mtw.sidebar', collapsed ? 'collapsed' : 'open');
    } catch {
      /* 무시 */
    }
  }, [collapsed]);
  return [collapsed, setCollapsed] as const;
}

export function AppShell({ children, onSearch }: Props) {
  const route = useRoute();
  const [collapsed, setCollapsed] = useCollapsed();
  const [moreOpen, setMoreOpen] = useState(false);
  const current = titleFor(route.name);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS/.test(navigator.userAgent);

  useEffect(() => setMoreOpen(false), [route.name]);

  return (
    <div className={cx('shell', collapsed && 'shell--collapsed')}>
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <aside className="sidebar" aria-label="주 메뉴">
        <div className="sidebar__brand">
          <span className="brand-mark" aria-hidden="true">
            <PixelIcon kind="star" size={16} color="var(--orange)" />
          </span>
          <span className="sidebar__brand-text">
            MY TEACHER
            <br />
            WORKSPACE
          </span>
        </div>
        <nav className="sidebar__nav">
          {NAV.map((n) => (
            <a
              key={n.route}
              href={`#/${n.route}`}
              className={cx('nav-link', route.name === n.route && 'is-active')}
              aria-current={route.name === n.route ? 'page' : undefined}
              title={collapsed ? n.ko : undefined}
            >
              <n.icon size={20} strokeWidth={2.2} aria-hidden="true" />
              <span className="nav-link__label">{n.label}</span>
              <span className="nav-link__ko">{n.ko}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar__foot">
          <a
            href={`#/${SETTINGS_NAV.route}`}
            className={cx('nav-link', route.name === 'settings' && 'is-active')}
            aria-current={route.name === 'settings' ? 'page' : undefined}
          >
            <SETTINGS_NAV.icon size={20} aria-hidden="true" />
            <span className="nav-link__label">Settings</span>
          </a>
          <button className="nav-link nav-link--btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}>
            {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
            <span className="nav-link__label">접기</span>
          </button>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn topbar__menu" onClick={() => setMoreOpen(true)} aria-label="메뉴 열기">
            <Menu size={22} />
          </button>
          <div className="topbar__title">
            <span className="topbar__en">{current.label.toUpperCase()}</span>
            <span className="topbar__ko">{current.ko}</span>
          </div>
          <div className="spacer" />
          <SyncIndicator />
          <button className="search-btn" onClick={onSearch} aria-label="전체 검색">
            <Search size={18} />
            <span className="search-btn__text">검색</span>
            <span className="kbd search-btn__kbd">{isMac ? '⌘K' : 'Ctrl K'}</span>
          </button>
        </header>
        <main id="main" className="main" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="하단 메뉴">
        {NAV.filter((n) => n.mobile).map((n) => (
          <a
            key={n.route}
            href={`#/${n.route}`}
            className={cx('bottom-nav__item', route.name === n.route && 'is-active')}
            aria-current={route.name === n.route ? 'page' : undefined}
          >
            <n.icon size={22} aria-hidden="true" />
            <span>{n.label}</span>
          </a>
        ))}
        <button className={cx('bottom-nav__item', moreOpen && 'is-active')} onClick={() => setMoreOpen(true)}>
          <MoreHorizontal size={22} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      <Drawer open={moreOpen} onClose={() => setMoreOpen(false)} title={<span className="title-font">MENU</span>} label="전체 메뉴">
        <div className="more-grid">
          {[...NAV, SETTINGS_NAV].map((n) => (
            <button key={n.route} className={cx('more-grid__item', route.name === n.route && 'is-active')} onClick={() => navigate(n.route)}>
              <n.icon size={24} aria-hidden="true" />
              <span className="title-font">{n.label}</span>
              <span className="muted">{n.ko}</span>
            </button>
          ))}
        </div>
      </Drawer>
    </div>
  );
}
