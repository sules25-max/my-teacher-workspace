import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { toast } from './components/common/overlays';
import { installFlushOnHide } from './services/flush';
import { applyUpdate, initAppUpdate } from './services/appUpdate';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/layout.css';
import './styles/planner.css';
import './styles/ink.css';
import './styles/pages.css';
import './styles/assistant.css';
import './styles/agent.css';

// 서비스 워커: 오프라인에서도 앱 셸이 열리도록 캐시한다.
// 새 버전이 있어도 자동으로 새로고침하지 않는다(입력 중인 내용 보호). 버튼을 누르면 저장을 끝낸 뒤 적용한다.
installFlushOnHide();
initAppUpdate(() => toast('새 버전이 준비됐어요.', { label: '적용', run: () => void applyUpdate() }, 10 * 60 * 1000));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
