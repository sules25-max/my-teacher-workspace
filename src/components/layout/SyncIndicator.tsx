import { useEffect, useState } from 'react';
import { useSyncState } from '../../services/sync/syncStatus';
import { runSync } from '../../services/sync/syncEngine';
import { cx } from '../../utils/id';

const LABEL = {
  saved: '✓ 저장됨',
  saving: '··· 저장 중',
  syncing: '↻ 동기화 중',
  offline: '! 오프라인',
  error: '! 동기화 오류',
  local: '✓ 기기에 저장됨',
} as const;

/** 화면을 방해하지 않는 작은 저장/동기화 상태 표시 */
export function SyncIndicator() {
  const s = useSyncState();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);
  const status = !online && s.status !== 'saving' ? 'offline' : s.status;
  const title = [s.message, s.pending ? `대기 중인 변경 ${s.pending}개` : '', s.lastSyncAt ? `마지막 동기화 ${new Date(s.lastSyncAt).toLocaleString('ko-KR')}` : '']
    .filter(Boolean)
    .join('\n');
  return (
    <button
      className={cx('sync-pill', `sync-pill--${status}`)}
      onClick={() => void runSync()}
      title={title || '지금 동기화'}
      aria-label={`${LABEL[status]}. 눌러서 지금 동기화`}
    >
      <span aria-hidden="true">{LABEL[status]}</span>
      {status === 'offline' && s.pending > 0 && <span className="sync-pill__count">{s.pending}</span>}
    </button>
  );
}
