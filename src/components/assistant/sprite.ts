import type { CSSProperties } from 'react';

export type AssistantExpression =
  | 'neutral'
  | 'happy'
  | 'excited'
  | 'surprised'
  | 'thinking'
  | 'worried'
  | 'confident'
  | 'shy';

/**
 * aichatbotseat.png: 4열 × 2행 sprite sheet.
 * 윗줄: neutral, happy, excited, surprised / 아랫줄: thinking, worried, confident, shy
 */
export const SPRITE_URL = `${import.meta.env.BASE_URL}aichatbotseat.png`;
const COLS = 4;
const ROWS = 2;

const ORDER: AssistantExpression[] = ['neutral', 'happy', 'excited', 'surprised', 'thinking', 'worried', 'confident', 'shy'];

/** 각 칸 안에서 얼굴 부분만 보이도록 자르는 비율(칸 크기 기준). 이미지를 바꾸면 여기만 조정한다. */
const CROP = { x0: 0.05, x1: 0.95, y0: 0.17, y1: 0.8 };

export const SPRITE_ASPECT = ((CROP.x1 - CROP.x0) / COLS) / ((CROP.y1 - CROP.y0) / ROWS) * (1448 / 1086);

export function spriteStyle(expression: AssistantExpression): CSSProperties {
  const i = Math.max(0, ORDER.indexOf(expression));
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const cw = (CROP.x1 - CROP.x0) / COLS; // 보이는 영역 / 전체 이미지
  const ch = (CROP.y1 - CROP.y0) / ROWS;
  const left = (col + CROP.x0) / COLS;
  const top = (row + CROP.y0) / ROWS;
  return {
    backgroundImage: `url(${SPRITE_URL})`,
    backgroundSize: `${100 / cw}% ${100 / ch}%`,
    backgroundPosition: `${(left / (1 - cw)) * 100}% ${(top / (1 - ch)) * 100}%`,
    backgroundRepeat: 'no-repeat',
  };
}
