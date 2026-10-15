import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { db } from '../../services/localDb';
import * as repo from '../../services/repo';
import { addFiles, useAttachments, useBlobUrl } from '../../services/attachments';
import type { Attachment, InkDoc, InkImage, InkPoint, Stroke } from '../../types';
import { uuid, cx } from '../../utils/id';
import { drawStroke, renderPreview, shouldAddPoint, strokeHit, strokeInRect, strokeBounds, INK_COLORS, HIGHLIGHT_COLORS, PEN_WIDTHS } from './inkRender';
import { InkToolbar, type InkTool } from './InkToolbar';
import { toast } from '../common/overlays';

interface Props {
  docId: string;
  /** 'fill'이면 부모 높이를 채우고 스크롤한다(자유보드). 기본은 내용 높이만큼 */
  mode?: 'fill' | 'inline';
  compactToolbar?: boolean;
}

interface Snapshot {
  strokes: Stroke[];
  images: InkImage[];
}

type Drag =
  | { kind: 'draw'; pointerId: number; stroke: Stroke }
  | { kind: 'erase'; pointerId: number; removed: boolean }
  | { kind: 'marquee'; pointerId: number; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'move'; pointerId: number; x0: number; y0: number; dx: number; dy: number }
  | { kind: 'image-move'; pointerId: number; id: string; x0: number; y0: number; orig: InkImage }
  | { kind: 'image-resize'; pointerId: number; id: string; x0: number; y0: number; orig: InkImage };

const BG_CLASS: Record<string, string> = { plain: '', lined: 'ink-bg--lined', grid: 'ink-bg--grid', dot: 'ink-bg--dot' };

export function InkCanvas({ docId, mode = 'inline', compactToolbar }: Props) {
  const [doc, setDoc] = useState<InkDoc | null>(null);
  const [snap, setSnap] = useState<Snapshot>({ strokes: [], images: [] });
  const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const [, forceHistory] = useState(0);

  const [tool, setTool] = useState<InkTool>('pen');
  const [penColor, setPenColor] = useState(INK_COLORS[0]);
  const [hlColor, setHlColor] = useState(HIGHLIGHT_COLORS[0]);
  const [penWidth, setPenWidth] = useState(PEN_WIDTHS[1]);
  const [pencilOnly, setPencilOnly] = useState(false);
  const penSeen = useRef(false);

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const drag = useRef<Drag | null>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  // ---------- 불러오기 ----------
  useEffect(() => {
    let alive = true;
    db.inkDocs.get(docId).then((d) => {
      if (!alive || !d) return;
      setDoc(d);
      setSnap({ strokes: d.strokes ?? [], images: d.images ?? [] });
      history.current = { past: [], future: [] };
    });
    return () => {
      alive = false;
    };
  }, [docId]);

  // ---------- 자동 저장 (stroke JSON + 미리보기 PNG) ----------
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dirty = useRef(false);
  const docRef = useRef(doc);
  docRef.current = doc;
  const flush = useCallback(async () => {
    const d = docRef.current;
    if (!d || !dirty.current) return;
    dirty.current = false;
    const s = snapRef.current;
    const next: InkDoc = { ...d, strokes: s.strokes, images: s.images, preview: renderPreview(s.strokes, d.width, d.height) };
    await repo.put('inkDocs', next);
  }, []);
  const scheduleSave = useCallback(() => {
    dirty.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), 900);
  }, [flush]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      clearTimeout(saveTimer.current);
      void flush();
    };
  }, [flush]);

  const commit = useCallback(
    (next: Snapshot) => {
      history.current.past.push(snapRef.current);
      if (history.current.past.length > 120) history.current.past.shift();
      history.current.future = [];
      snapRef.current = next;
      setSnap(next);
      forceHistory((n) => n + 1);
      scheduleSave();
    },
    [scheduleSave],
  );

  const undo = useCallback(() => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(snapRef.current);
    setSnap(prev);
    setSelection(new Set());
    forceHistory((n) => n + 1);
    scheduleSave();
  }, [scheduleSave]);
  const redo = useCallback(() => {
    const nx = history.current.future.pop();
    if (!nx) return;
    history.current.past.push(snapRef.current);
    setSnap(nx);
    forceHistory((n) => n + 1);
    scheduleSave();
  }, [scheduleSave]);

  // ---------- 크기 ----------
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || !doc) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setScale(w / doc.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  // ---------- 그리기 ----------
  const redraw = useCallback(
    (live?: Stroke) => {
      const c = canvasRef.current;
      if (!c || !doc) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.round(doc.width * scale * dpr);
      const h = Math.round(doc.height * scale * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      const d = drag.current;
      const offset = d?.kind === 'move' ? d : null;
      for (const s of snapRef.current.strokes) {
        if (offset && selection.has(s.id)) {
          ctx.save();
          ctx.translate(offset.dx, offset.dy);
          drawStroke(ctx, s);
          ctx.restore();
        } else drawStroke(ctx, s);
      }
      if (live) drawStroke(ctx, live);
      // 선택 표시
      if (selection.size) {
        const b = selectionBounds(snapRef.current.strokes, selection);
        if (b) {
          ctx.save();
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = '#FF6680';
          ctx.lineWidth = 1.5 / scale;
          ctx.strokeRect(b.x - 6 + (offset?.dx ?? 0), b.y - 6 + (offset?.dy ?? 0), b.w + 12, b.h + 12);
          ctx.restore();
        }
      }
    },
    [doc, scale, selection],
  );

  useEffect(() => redraw(), [redraw, snap]);

  const toDoc = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const rejectTouch = (e: React.PointerEvent) => e.pointerType === 'touch' && (pencilOnly || penSeen.current);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen' && !penSeen.current) {
      penSeen.current = true;
      setPencilOnly(true); // Apple Pencil이 감지되면 손가락 입력은 스크롤용으로 돌린다(손바닥 오입력 방지)
    }
    if (rejectTouch(e) || drag.current) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    canvasRef.current!.setPointerCapture(e.pointerId);
    const p = toDoc(e);
    setSelectedImage(null);
    if (tool === 'pen' || tool === 'highlighter') {
      setSelection(new Set());
      const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5;
      drag.current = {
        kind: 'draw',
        pointerId: e.pointerId,
        stroke: {
          id: uuid(),
          tool,
          color: tool === 'pen' ? penColor : hlColor,
          // 넓은 보드에서도 화면상 굵기가 비슷하도록 문서 폭(1200 기준)에 비례
          width: (tool === 'pen' ? penWidth : penWidth * 5) * ((doc?.width ?? 1200) / 1200),
          points: [{ x: round(p.x), y: round(p.y), pressure: round(pressure) }],
        },
      };
      redraw(drag.current.stroke);
    } else if (tool === 'eraser') {
      drag.current = { kind: 'erase', pointerId: e.pointerId, removed: false };
      eraseAt(p.x, p.y);
    } else if (tool === 'select') {
      const b = selection.size ? selectionBounds(snapRef.current.strokes, selection) : null;
      if (b && p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10) {
        drag.current = { kind: 'move', pointerId: e.pointerId, x0: p.x, y0: p.y, dx: 0, dy: 0 };
      } else {
        setSelection(new Set());
        drag.current = { kind: 'marquee', pointerId: e.pointerId, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      }
    }
  };

  const eraseAt = (x: number, y: number) => {
    const d = drag.current;
    if (d?.kind !== 'erase') return;
    const r = 10 / Math.max(scale, 0.4);
    const keep = snapRef.current.strokes.filter((s) => !strokeHit(s, x, y, r));
    if (keep.length !== snapRef.current.strokes.length) {
      if (!d.removed) {
        history.current.past.push(snapRef.current);
        history.current.future = [];
        d.removed = true;
      }
      const next = { ...snapRef.current, strokes: keep };
      snapRef.current = next;
      setSnap(next);
      scheduleSave();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
    const list = events.length ? events : [e.nativeEvent];
    if (d.kind === 'draw') {
      for (const ev of list) {
        const p = toDoc(ev);
        const pts = d.stroke.points;
        if (shouldAddPoint(pts[pts.length - 1], p.x, p.y)) {
          const pressure = ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5;
          pts.push({ x: round(p.x), y: round(p.y), pressure: round(pressure) });
        }
      }
      redraw(d.stroke);
    } else if (d.kind === 'erase') {
      for (const ev of list) {
        const p = toDoc(ev);
        eraseAt(p.x, p.y);
      }
    } else if (d.kind === 'marquee') {
      const p = toDoc(e);
      d.x1 = p.x;
      d.y1 = p.y;
      setMarquee(normRect(d.x0, d.y0, d.x1, d.y1));
    } else if (d.kind === 'move') {
      const p = toDoc(e);
      d.dx = p.x - d.x0;
      d.dy = p.y - d.y0;
      redraw();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.kind === 'draw') {
      commit({ ...snapRef.current, strokes: [...snapRef.current.strokes, d.stroke] });
    } else if (d.kind === 'marquee') {
      const r = normRect(d.x0, d.y0, d.x1, d.y1);
      setMarquee(null);
      if (r.w > 4 || r.h > 4) setSelection(new Set(snapRef.current.strokes.filter((s) => strokeInRect(s, r)).map((s) => s.id)));
    } else if (d.kind === 'move') {
      if (Math.abs(d.dx) > 0.5 || Math.abs(d.dy) > 0.5) {
        commit({
          ...snapRef.current,
          strokes: snapRef.current.strokes.map((s) =>
            selection.has(s.id) ? { ...s, points: s.points.map((pt) => ({ ...pt, x: round(pt.x + d.dx), y: round(pt.y + d.dy) })) } : s,
          ),
        });
      } else redraw();
    }
  };

  // iOS: Pencil 터치가 페이지 스크롤로 해석되지 않도록 막는다. 손가락 터치는 그대로 스크롤.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onTouch = (ev: TouchEvent) => {
      const stylus = Array.from(ev.touches).some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus');
      if (stylus || !(pencilOnly || penSeen.current)) ev.preventDefault();
    };
    c.addEventListener('touchstart', onTouch, { passive: false });
    c.addEventListener('touchmove', onTouch, { passive: false });
    return () => {
      c.removeEventListener('touchstart', onTouch);
      c.removeEventListener('touchmove', onTouch);
    };
  }, [pencilOnly, doc]);

  // ---------- 이미지 ----------
  const imageIds = snap.images.map((i) => i.attachmentId);
  const attachments = useAttachments(imageIds);

  const addImages = async (files: FileList) => {
    if (!doc) return;
    const atts = await addFiles(files, { type: 'inkDoc', id: doc.id });
    const wrap = wrapRef.current;
    const viewTop = wrap ? Math.max(0, -wrap.getBoundingClientRect().top / scale) : 0;
    const added: InkImage[] = [];
    for (const [i, a] of atts.filter((x) => x.kind === 'photo').entries()) {
      const dims = await imageSize(a);
      const w = Math.min(doc.width * 0.6, dims.w);
      const h = (w / dims.w) * dims.h;
      added.push({ id: uuid(), attachmentId: a.id, x: round(doc.width * 0.2 + i * 24), y: round(viewTop + 80 + i * 24), w: round(w), h: round(h) });
    }
    if (added.length) {
      commit({ ...snapRef.current, images: [...snapRef.current.images, ...added] });
      setTool('select');
      setSelectedImage(added[0].id);
    }
  };

  const onImagePointerDown = (e: React.PointerEvent, img: InkImage, kind: 'image-move' | 'image-resize') => {
    if (tool !== 'select') return; // 다른 도구일 때는 사진 위에 필기한다
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toDoc(e);
    setSelectedImage(img.id);
    setSelection(new Set());
    drag.current = { kind, pointerId: e.pointerId, id: img.id, x0: p.x, y0: p.y, orig: img };
  };
  const onImagePointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || (d.kind !== 'image-move' && d.kind !== 'image-resize')) return;
    const p = toDoc(e);
    const dx = p.x - d.x0;
    const dy = p.y - d.y0;
    const images = snapRef.current.images.map((im) => {
      if (im.id !== d.id) return im;
      if (d.kind === 'image-move') return { ...im, x: round(d.orig.x + dx), y: round(d.orig.y + dy) };
      const w = Math.max(60, d.orig.w + dx);
      return { ...im, w: round(w), h: round((w / d.orig.w) * d.orig.h) };
    });
    snapRef.current = { ...snapRef.current, images };
    setSnap(snapRef.current);
  };
  const onImagePointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || (d.kind !== 'image-move' && d.kind !== 'image-resize')) return;
    drag.current = null;
    const final = snapRef.current;
    snapRef.current = { ...final, images: final.images.map((im) => (im.id === d.id ? d.orig : im)) };
    commit(final);
  };

  const deleteSelected = () => {
    if (selectedImage) {
      commit({ ...snapRef.current, images: snapRef.current.images.filter((i) => i.id !== selectedImage) });
      setSelectedImage(null);
      return;
    }
    if (selection.size) {
      commit({ ...snapRef.current, strokes: snapRef.current.strokes.filter((s) => !selection.has(s.id)) });
      setSelection(new Set());
    }
  };

  const clearAll = () => {
    if (!snapRef.current.strokes.length && !snapRef.current.images.length) return;
    commit({ strokes: [], images: [] });
    toast('페이지를 비웠어요.', { label: '되돌리기', run: undo });
  };

  const extend = async () => {
    if (!doc) return;
    const next = { ...doc, height: doc.height + 800 };
    setDoc(next);
    docRef.current = next;
    dirty.current = true;
    await flush();
  };

  // 키보드 단축키: ⌘Z / ⇧⌘Z / Delete
  useEffect(() => {
    const el = wrapRef.current?.parentElement;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && (selection.size || selectedImage)) {
        e.preventDefault();
        deleteSelected();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  if (!doc) return <div className="ink-loading muted">필기 불러오는 중…</div>;

  const cursor = tool === 'select' ? 'crosshair' : tool === 'eraser' ? 'cell' : 'crosshair';

  return (
    <div className={cx('ink', mode === 'fill' && 'ink--fill')} tabIndex={-1}>
      <InkToolbar
        compact={compactToolbar}
        tool={tool}
        setTool={(t) => {
          setTool(t);
          setSelection(new Set());
          setSelectedImage(null);
        }}
        penColor={penColor}
        setPenColor={setPenColor}
        hlColor={hlColor}
        setHlColor={setHlColor}
        penWidth={penWidth}
        setPenWidth={setPenWidth}
        canUndo={history.current.past.length > 0}
        canRedo={history.current.future.length > 0}
        undo={undo}
        redo={redo}
        pencilOnly={pencilOnly}
        setPencilOnly={setPencilOnly}
        hasSelection={selection.size > 0 || !!selectedImage}
        deleteSelected={deleteSelected}
        onImages={addImages}
        clearAll={clearAll}
        extend={mode === 'fill' ? extend : undefined}
      />
      <div className="ink__scroll">
        <div className="ink__page-wrap" ref={wrapRef}>
          <div
            className={cx('ink__page', BG_CLASS[doc.background])}
            style={{ height: doc.height * scale, ['--ink-scale' as string]: scale }}
          >
            {snap.images.map((img) => (
              <InkImageView
                key={img.id}
                img={img}
                scale={scale}
                att={attachments.find((a) => a.id === img.attachmentId)}
                selectable={tool === 'select'}
                selected={selectedImage === img.id}
                onPointerDown={onImagePointerDown}
                onPointerMove={onImagePointerMove}
                onPointerUp={onImagePointerUp}
              />
            ))}
            <canvas
              ref={canvasRef}
              className="ink__canvas"
              style={{
                width: doc.width * scale,
                height: doc.height * scale,
                cursor,
                touchAction: pencilOnly ? 'pan-x pan-y' : 'none',
                pointerEvents: tool === 'select' && selectedImage ? 'none' : 'auto',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label="필기 영역. Apple Pencil, 마우스, 터치로 그릴 수 있어요"
              role="img"
            />
            {tool === 'select' && selectedImage && (
              <button className="ink__deselect" onClick={() => setSelectedImage(null)}>
                사진 선택 해제
              </button>
            )}
            {marquee && (
              <div
                className="ink__marquee"
                style={{ left: marquee.x * scale, top: marquee.y * scale, width: marquee.w * scale, height: marquee.h * scale }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InkImageView({
  img,
  scale,
  att,
  selectable,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  img: InkImage;
  scale: number;
  att?: Attachment;
  selectable: boolean;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent, img: InkImage, kind: 'image-move' | 'image-resize') => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  const url = useBlobUrl(att);
  return (
    <div
      className={cx('ink__img', selected && 'is-selected', selectable && 'is-selectable')}
      style={{ left: img.x * scale, top: img.y * scale, width: img.w * scale, height: img.h * scale, zIndex: selectable ? 3 : 0 }}
      onPointerDown={(e) => onPointerDown(e, img, 'image-move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {url ? <img src={url} alt={att?.name ?? '첨부 사진'} draggable={false} /> : <span className="muted">사진 불러오는 중…</span>}
      {selected && (
        <span
          className="ink__handle"
          onPointerDown={(e) => onPointerDown(e, img, 'image-resize')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-label="크기 조절"
        />
      )}
    </div>
  );
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function normRect(x0: number, y0: number, x1: number, y1: number) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

function selectionBounds(strokes: Stroke[], sel: Set<string>) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of strokes) {
    if (!sel.has(s.id)) continue;
    const b = strokeBounds(s);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

async function imageSize(a: Attachment): Promise<{ w: number; h: number }> {
  if (!a.blob) return { w: 600, h: 400 };
  try {
    const bmp = await createImageBitmap(a.blob);
    return { w: bmp.width, h: bmp.height };
  } catch {
    return { w: 600, h: 400 };
  }
}

export type { InkPoint };
