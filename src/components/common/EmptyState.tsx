import type { ReactNode } from 'react';
import { AssistantAvatar } from '../assistant/AssistantAvatar';
import type { AssistantExpression } from '../assistant/sprite';

interface Props {
  text: string;
  action?: ReactNode;
  expression?: AssistantExpression;
  avatar?: boolean;
}

export function EmptyState({ text, action, expression = 'neutral', avatar = true }: Props) {
  return (
    <div className="empty">
      {avatar && <AssistantAvatar expression={expression} size={44} />}
      <div className="empty__text">
        <span>{text}</span>
        {action}
      </div>
    </div>
  );
}
