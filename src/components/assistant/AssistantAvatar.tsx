import { SPRITE_ASPECT, spriteStyle, type AssistantExpression } from './sprite';
import { cx } from '../../utils/id';

interface Props {
  expression?: AssistantExpression;
  size?: number; // 너비(px)
  className?: string;
  framed?: boolean;
}

/** <AssistantAvatar expression="thinking" /> */
export function AssistantAvatar({ expression = 'neutral', size = 64, className, framed = true }: Props) {
  return (
    <span
      className={cx('avatar', framed && 'avatar--framed', className)}
      role="img"
      aria-label={`AI 비서 (${expression})`}
      style={{ width: size, height: Math.round(size / SPRITE_ASPECT), ...spriteStyle(expression) }}
    />
  );
}
