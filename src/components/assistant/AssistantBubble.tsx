import type { ReactNode } from 'react';
import { cx } from '../../utils/id';

/** Y2K 픽셀 말풍선: 계단 모서리 + 픽셀 꼬리 */
export function AssistantBubble({ children, className, tail = 'bottom-right' }: { children: ReactNode; className?: string; tail?: 'bottom-right' | 'left' }) {
  return <div className={cx('pixel-bubble', `pixel-bubble--${tail}`, className)}>{children}</div>;
}
