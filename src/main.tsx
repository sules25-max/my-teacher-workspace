import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/layout.css';
import './styles/planner.css';
import './styles/ink.css';
import './styles/pages.css';
import './styles/assistant.css';
import './styles/agent.css';

// 서비스 워커: 오프라인에서도 앱 셸이 열리도록 캐시하고, 새 버전이 있으면 자동 갱신한다.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
