import { useCallback, useEffect, useRef, useState } from 'react';
import type { SlotRef } from '../../services/planner';

// 주간 플래너에서 수업 칸 끌어서 옮기기.
// 마우스: 6px 이상 끌면 시작 / 터치 · Pencil: 0.35초 길게 누르면 시작(그냥 스크롤은 방해하지 않음).
// 놓은 곳은 data-slot="날짜|교시ID" 속성으로 찾는다.

export interface DragState {
  from: SlotRef;
  label: string;
  x: number;
  y: number;
  over?: SlotRef;
}

const HOLD_MS = 350;

function slotAt(x: number, y: number): SlotRef | undefined {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot]');
  if (!el) return undefined;
  const [date, periodId] = (el.dataset.slot ?? '').split('|');
  return date && periodId ? { date, periodId } : undefined;
}

export function useLessonDrag(onDrop: (from: SlotRef, to: SlotRef) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const pending = useRef<{ id: number; x: number; y: number; from: SlotRef; label: string; touch: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const suppressClick = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  // 상태를 ref에도 바로 넣는다(다시 그려지기 전에 손을 떼도 놓은 곳을 알 수 있게)
  const update = (d: DragState | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const begin = (p: NonNullable<typeof pending.current>, x: number, y: number) => {
    window.getSelection()?.removeAllRanges(); // 끄는 동안 글자 선택이 생기지 않게
    update({ from: p.from, label: p.label, x, y, over: slotAt(x, y) });
    if ('vibrate' in navigator) navigator.vibrate?.(15);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.id) return;
      const d = dragRef.current;
      if (!d) {
        const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        if (!p.touch && dist > 6) begin(p, e.clientX, e.clientY);
        else if (p.touch && dist > 10) {
          // 길게 누르기 전에 움직이면 스크롤로 본다
          clearTimeout(p.timer);
          pending.current = null;
        }
        return;
      }
      update({ ...d, x: e.clientX, y: e.clientY, over: slotAt(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.id) return;
      clearTimeout(p.timer);
      pending.current = null;
      const d = dragRef.current;
      if (!d) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 50);
      update(null);
      const to = slotAt(e.clientX, e.clientY);
      if (to && (to.date !== d.from.date || to.periodId !== d.from.periodId)) dropRef.current(d.from, to);
    };
    const cancel = () => {
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
      update(null);
    };
    const noSelect = (e: Event) => {
      if (dragRef.current || (pending.current && !pending.current.touch)) e.preventDefault();
    };
    document.addEventListener('selectstart', noSelect);
    // 드래그 중에는 화면이 스크롤되지 않게
    const touchmove = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    document.addEventListener('touchmove', touchmove, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchmove', touchmove);
      document.removeEventListener('selectstart', noSelect);
    };
  }, []);

  /** 수업 칸에 붙이는 핸들러 */
  const handleProps = useCallback(
    (from: SlotRef, label: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const touch = e.pointerType !== 'mouse';
        const p = { id: e.pointerId, x: e.clientX, y: e.clientY, from, label, touch } as NonNullable<typeof pending.current>;
        if (touch) p.timer = setTimeout(() => pending.current === p && begin(p, p.x, p.y), HOLD_MS);
        pending.current = p;
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (suppressClick.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      onContextMenu: (e: React.MouseEvent) => {
        if (pending.current?.touch) e.preventDefault(); // 길게 누를 때 iOS 메뉴 막기
      },
    }),
    [],
  );

  return { drag, handleProps };
}
