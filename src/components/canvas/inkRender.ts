import type { InkPoint, Stroke } from '../../types';

// 손글씨 렌더링 · 판정 함수. 좌표는 모두 문서 좌표(InkDoc.width 기준)다.

export const INK_COLORS = ['#152A4B', '#FF6680', '#2F7FB5', '#FFAD32', '#3F9B78'];
export const HIGHLIGHT_COLORS = ['#FFD464', '#FFB8C6', '#A6DCF5', '#C3F0B8'];
export const PEN_WIDTHS = [2, 3.5, 6];

export function pressureWidth(base: number, p: number) {
  return base * (0.35 + Math.min(1, Math.max(0.05, p)) * 1.15);
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const pts = s.points;
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  if (s.tool === 'highlighter') {
    ctx.globalAlpha = 0.42;
    ctx.globalCompositeOperation = 'multiply';
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (pts.length === 1) ctx.lineTo(pts[0].x + 0.1, pts[0].y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, pressureWidth(s.width, pts[0].pressure) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  // 중점 기반 2차 곡선 + 구간별 압력 두께
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const prevMid = i > 1 ? mid(pts[i - 2], p0) : p0;
    const curMid = mid(p0, p1);
    ctx.beginPath();
    ctx.lineWidth = pressureWidth(s.width, (p0.pressure + p1.pressure) / 2);
    ctx.moveTo(prevMid.x, prevMid.y);
    ctx.quadraticCurveTo(p0.x, p0.y, curMid.x, curMid.y);
    if (i === pts.length - 1) ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.restore();
}

function mid(a: InkPoint, b: InkPoint) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function strokeBounds(s: Stroke) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function distToSegment(px: number, py: number, a: InkPoint, b: InkPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - a.x) * dx + (py - a.y) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(px - x, py - y);
}

export function strokeHit(s: Stroke, x: number, y: number, radius: number): boolean {
  const b = strokeBounds(s);
  const pad = radius + s.width;
  if (x < b.minX - pad || x > b.maxX + pad || y < b.minY - pad || y > b.maxY + pad) return false;
  if (s.points.length === 1) return Math.hypot(x - s.points[0].x, y - s.points[0].y) <= pad;
  for (let i = 1; i < s.points.length; i++) {
    if (distToSegment(x, y, s.points[i - 1], s.points[i]) <= radius + s.width / 2) return true;
  }
  return false;
}

export function strokeInRect(s: Stroke, r: { x: number; y: number; w: number; h: number }) {
  return s.points.some((p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
}

/** 간단한 거리 기반 점 줄이기: 너무 촘촘한 점은 저장하지 않는다. */
export function shouldAddPoint(last: InkPoint | undefined, x: number, y: number) {
  return !last || Math.hypot(last.x - x, last.y - y) >= 0.8;
}

export function renderPreview(strokes: Stroke[], width: number, height: number, max = 360): string {
  const scale = max / Math.max(width, height);
  const c = document.createElement('canvas');
  c.width = Math.round(width * scale);
  c.height = Math.round(height * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(scale, scale);
  strokes.forEach((s) => drawStroke(ctx, s));
  return c.toDataURL('image/png');
}
