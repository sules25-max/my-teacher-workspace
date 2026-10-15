import type { CSSProperties, ReactElement } from 'react';

// 픽셀 아트 장식. 6×6 / 7×7 격자를 SVG rect로 그려 계단 모서리를 살린다.
const SHAPES: Record<string, string[]> = {
  plus: ['..#..', '..#..', '#####', '..#..', '..#..'],
  star: ['...#...', '...#...', '..###..', '#######', '..###..', '...#...', '...#...'],
  heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  bang: ['##', '##', '##', '##', '..', '##'],
  dots: ['#.#.#'],
  sparkle: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
};

export type DecoKind = keyof typeof SHAPES;

interface Props {
  kind: DecoKind;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}

export function PixelIcon({ kind, size = 14, color = 'currentColor', className, style }: Props) {
  const rows = SHAPES[kind];
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const rects: ReactElement[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === '#') rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} />);
    }),
  );
  return (
    <svg
      className={className}
      style={style}
      width={(size * w) / Math.max(w, h)}
      height={(size * h) / Math.max(w, h)}
      viewBox={`0 0 ${w} ${h}`}
      fill={color}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rects}
    </svg>
  );
}

/** 카드 모서리 등에 절대 위치로 흩뿌리는 장식 */
export function Deco({ kind, size, color, style }: Props) {
  return (
    <span className="deco" style={style}>
      <PixelIcon kind={kind} size={size} color={color} />
    </span>
  );
}
