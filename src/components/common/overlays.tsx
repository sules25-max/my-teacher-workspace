import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../../utils/id';

// ---------- 포커스 관리 + ESC 닫기 ----------
function useDialogBehavior(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current;
      el?.focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open]);
  return ref;
}

interface PanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  label?: string;
}

export function Drawer({ open, onClose, title, children, actions, label }: PanelProps) {
  const ref = useDialogBehavior(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={label} ref={ref} tabIndex={-1}>
        <div className="drawer__head">
          <div style={{ flex: 1, minWidth: 0 }}>{title}</div>
          {actions}
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={22} />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
      </div>
    </>,
    document.body,
  );
}

export function Modal({ open, onClose, title, children, footer, wide, label }: PanelProps) {
  const ref = useDialogBehavior(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="overlay overlay--top" onClick={onClose} />
      <div className={cx('modal', wide && 'modal--wide')} role="dialog" aria-modal="true" aria-label={label} ref={ref} tabIndex={-1}>
        <div className="modal__head">
          <div style={{ flex: 1, minWidth: 0 }} className="title-font">
            {title}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={22} />
          </button>
        </div>
        {wide ? children : <div className="modal__body">{children}</div>}
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

// ---------- 토스트 ----------
interface ToastItem {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}
let toasts: ToastItem[] = [];
const toastListeners = new Set<() => void>();
let toastSeq = 1;
function emitToasts() {
  toastListeners.forEach((l) => l());
}

export function toast(message: string, action?: ToastItem['action'], ms = 4200) {
  const id = toastSeq++;
  toasts = [...toasts.slice(-2), { id, message, action }];
  emitToasts();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emitToasts();
  }, ms);
}

export function ToastHost() {
  const items = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div className="toast" key={t.id}>
          <span className="toast__msg">{t.message}</span>
          {t.action && (
            <button
              className="btn btn--sm"
              onClick={() => {
                t.action!.run();
                toasts = toasts.filter((x) => x.id !== t.id);
                emitToasts();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---------- 확인 / 입력 대화상자 (Promise 기반) ----------
interface DialogReq {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  defaultValue?: string;
  placeholder?: string;
  resolve: (v: unknown) => void;
}
let current: DialogReq | null = null;
const dialogListeners = new Set<() => void>();
function setDialog(d: DialogReq | null) {
  current = d;
  dialogListeners.forEach((l) => l());
}

export function confirmDialog(opts: Omit<DialogReq, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => setDialog({ ...opts, kind: 'confirm', resolve: (v) => resolve(Boolean(v)) }));
}

export function promptDialog(opts: Omit<DialogReq, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => setDialog({ ...opts, kind: 'prompt', resolve: (v) => resolve(v as string | null) }));
}

export function DialogHost() {
  const d = useSyncExternalStore(
    (l) => {
      dialogListeners.add(l);
      return () => dialogListeners.delete(l);
    },
    () => current,
  );
  const [value, setValue] = useState('');
  useEffect(() => setValue(d?.defaultValue ?? ''), [d]);
  if (!d) return null;
  const close = (v: unknown) => {
    d.resolve(v);
    setDialog(null);
  };
  return (
    <Modal
      open
      onClose={() => close(d.kind === 'prompt' ? null : false)}
      title={d.title}
      label={d.title}
      footer={
        <>
          <button className="btn" onClick={() => close(d.kind === 'prompt' ? null : false)}>
            {d.cancelLabel ?? '취소'}
          </button>
          <button
            className={cx('btn', d.danger ? 'btn--pink' : 'btn--primary')}
            data-autofocus={d.kind === 'confirm' ? true : undefined}
            onClick={() => close(d.kind === 'prompt' ? value : true)}
          >
            {d.confirmLabel ?? '확인'}
          </button>
        </>
      }
    >
      <div className="stack">
        {d.message && <div style={{ whiteSpace: 'pre-line' }}>{d.message}</div>}
        {d.kind === 'prompt' && (
          <input
            className="input"
            data-autofocus
            value={value}
            placeholder={d.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) close(value);
            }}
          />
        )}
      </div>
    </Modal>
  );
}
