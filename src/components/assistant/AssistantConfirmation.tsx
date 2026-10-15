import { useState } from 'react';
import type { ProposedAction } from '../../services/ai/assistant';
import { cx } from '../../utils/id';

/** WRITE/DELETE는 이 카드에서 사용자가 직접 [반영]을 눌러야 실행된다. */
export function AssistantConfirmation({ action, onResult }: { action: ProposedAction; onResult: (text: string | null) => void }) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'cancelled'>('idle');
  return (
    <div className={cx('ai-confirm', action.kind === 'delete' && 'ai-confirm--danger', state !== 'idle' && 'is-settled')}>
      <p className="ai-confirm__title title-font">{action.kind === 'delete' ? '삭제 확인' : '이렇게 바뀌어요'}</p>
      <ul className="list-reset ai-confirm__list">
        {action.detail.slice(0, 8).map((d, i) => (
          <li key={i}>{d}</li>
        ))}
        {action.detail.length > 8 && <li className="muted">…외 {action.detail.length - 8}개</li>}
      </ul>
      {state === 'idle' || state === 'running' ? (
        <div className="row">
          <button
            className={cx('btn btn--sm', action.kind === 'delete' ? 'btn--pink' : 'btn--primary')}
            disabled={state === 'running'}
            onClick={async () => {
              setState('running');
              try {
                const msg = await action.run();
                setState('done');
                onResult(msg);
              } catch (e) {
                setState('idle');
                onResult(`앗, 반영하지 못했어: ${(e as Error).message}`);
              }
            }}
          >
            {action.label}
          </button>
          <button
            className="btn btn--sm"
            disabled={state === 'running'}
            onClick={() => {
              setState('cancelled');
              onResult(null);
            }}
          >
            취소
          </button>
        </div>
      ) : (
        <p className="muted ai-confirm__state">{state === 'done' ? '✓ 반영함' : '취소함'}</p>
      )}
    </div>
  );
}
