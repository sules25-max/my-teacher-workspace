import { useRef } from 'react';
import { Eraser, Highlighter, ImagePlus, Camera, MousePointer2, Pen, Redo2, Trash2, Undo2, Hand, ChevronsDown, Type, Eraser as ClearIcon } from 'lucide-react';
import { HIGHLIGHT_COLORS, INK_COLORS, PEN_WIDTHS, TEXT_SIZES } from './inkRender';
import { cx } from '../../utils/id';

export type InkTool = 'pen' | 'highlighter' | 'text' | 'eraser' | 'select';

interface Props {
  tool: InkTool;
  setTool: (t: InkTool) => void;
  penColor: string;
  setPenColor: (c: string) => void;
  hlColor: string;
  setHlColor: (c: string) => void;
  penWidth: number;
  setPenWidth: (w: number) => void;
  textSize: number;
  setTextSize: (n: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  pencilOnly: boolean;
  setPencilOnly: (v: boolean) => void;
  hasSelection: boolean;
  deleteSelected: () => void;
  onImages: (f: FileList) => void;
  clearAll: () => void;
  extend?: () => void;
  compact?: boolean;
}

const TOOLS: { id: InkTool; label: string; Icon: typeof Pen }[] = [
  { id: 'pen', label: '펜', Icon: Pen },
  { id: 'highlighter', label: '형광펜', Icon: Highlighter },
  { id: 'text', label: '글상자 (키보드로 입력)', Icon: Type },
  { id: 'eraser', label: '지우개', Icon: Eraser },
  { id: 'select', label: '선택', Icon: MousePointer2 },
];

export function InkToolbar(p: Props) {
  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const colors = p.tool === 'highlighter' ? HIGHLIGHT_COLORS : INK_COLORS;
  const activeColor = p.tool === 'highlighter' ? p.hlColor : p.penColor;
  const setColor = p.tool === 'highlighter' ? p.setHlColor : p.setPenColor;
  return (
    <div className={cx('ink-toolbar', p.compact && 'ink-toolbar--compact')} role="toolbar" aria-label="필기 도구">
      <div className="ink-toolbar__group">
        {TOOLS.map(({ id, label, Icon }) => (
          <button key={id} className="icon-btn" aria-pressed={p.tool === id} onClick={() => p.setTool(id)} aria-label={label} title={label}>
            <Icon size={20} />
          </button>
        ))}
      </div>
      {(p.tool === 'pen' || p.tool === 'highlighter' || p.tool === 'text') && (
        <div className="ink-toolbar__group">
          {colors.map((c) => (
            <button
              key={c}
              className={cx('swatch', activeColor === c && 'is-active')}
              style={{ ['--swatch' as string]: c }}
              onClick={() => setColor(c)}
              aria-label={`색 ${c}`}
              aria-pressed={activeColor === c}
            />
          ))}
          {p.tool === 'pen' &&
            PEN_WIDTHS.map((w) => (
              <button key={w} className={cx('width-dot', p.penWidth === w && 'is-active')} onClick={() => p.setPenWidth(w)} aria-label={`굵기 ${w}`} aria-pressed={p.penWidth === w}>
                <span style={{ width: w * 2.2, height: w * 2.2 }} />
              </button>
            ))}
          {p.tool === 'text' &&
            TEXT_SIZES.map((n, i) => (
              <button key={n} className={cx('width-dot text-size', p.textSize === n && 'is-active')} onClick={() => p.setTextSize(n)} aria-label={`글자 크기 ${['작게', '보통', '크게'][i]}`} aria-pressed={p.textSize === n}>
                <span style={{ fontSize: 12 + i * 5 }}>가</span>
              </button>
            ))}
        </div>
      )}
      <div className="ink-toolbar__group">
        <button className="icon-btn" onClick={p.undo} disabled={!p.canUndo} aria-label="실행취소" title="실행취소">
          <Undo2 size={20} />
        </button>
        <button className="icon-btn" onClick={p.redo} disabled={!p.canRedo} aria-label="다시실행" title="다시실행">
          <Redo2 size={20} />
        </button>
        {p.hasSelection && (
          <button className="icon-btn" onClick={p.deleteSelected} aria-label="선택 삭제" title="선택 삭제">
            <Trash2 size={20} color="var(--pink)" />
          </button>
        )}
      </div>
      <div className="ink-toolbar__group">
        <button className="icon-btn" onClick={() => photoRef.current?.click()} aria-label="사진 넣기" title="사진 · 파일에서 넣기">
          <ImagePlus size={20} />
        </button>
        <button className="icon-btn" onClick={() => cameraRef.current?.click()} aria-label="사진 촬영" title="사진 촬영">
          <Camera size={20} />
        </button>
        <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && (p.onImages(e.target.files), (e.target.value = ''))} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files && (p.onImages(e.target.files), (e.target.value = ''))} />
      </div>
      <div className="ink-toolbar__group ink-toolbar__end">
        <button
          className="icon-btn"
          aria-pressed={p.pencilOnly}
          onClick={() => p.setPencilOnly(!p.pencilOnly)}
          aria-label="펜슬 전용 모드 (손가락은 스크롤)"
          title="펜슬 전용: 손가락은 스크롤, Pencil만 필기"
        >
          <Hand size={20} />
        </button>
        {p.extend && (
          <button className="icon-btn" onClick={p.extend} aria-label="페이지 늘리기" title="아래로 페이지 늘리기">
            <ChevronsDown size={20} />
          </button>
        )}
        <button className="icon-btn" onClick={p.clearAll} aria-label="전체 지우기" title="전체 지우기">
          <ClearIcon size={18} style={{ opacity: 0.55 }} />
        </button>
      </div>
    </div>
  );
}
