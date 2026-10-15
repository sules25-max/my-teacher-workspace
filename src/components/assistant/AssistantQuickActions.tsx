import { QUICK_ACTIONS, type QuickActionId } from '../../services/ai/assistant';

export function AssistantQuickActions({ onPick, disabled }: { onPick: (id: QuickActionId) => void; disabled?: boolean }) {
  return (
    <div className="ai-quick" role="group" aria-label="빠른 작업">
      {QUICK_ACTIONS.map((a) => (
        <button key={a.id} className="ai-quick__btn" disabled={disabled} onClick={() => onPick(a.id)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}
