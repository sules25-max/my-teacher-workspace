import { useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Plus, X } from 'lucide-react';
import { useAutosave } from '../../hooks/useAutosave';
import type { CheckItem } from '../../types';
import { cx, uuid } from '../../utils/id';

type TAProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>;
type InProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

/** 디바운스 자동 저장 textarea */
export function AutoTextarea({
  saveKey,
  value,
  onSave,
  lined,
  className,
  ...rest
}: TAProps & { saveKey: string; value: string; onSave: (v: string) => void | Promise<void>; lined?: boolean }) {
  const [v, setV, flush] = useAutosave(saveKey, value, onSave, 900);
  return (
    <textarea
      {...rest}
      className={cx('textarea', lined && 'textarea--lined', className)}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={flush}
    />
  );
}

export function AutoInput({
  saveKey,
  value,
  onSave,
  className,
  ...rest
}: InProps & { saveKey: string; value: string; onSave: (v: string) => void | Promise<void> }) {
  const [v, setV, flush] = useAutosave(saveKey, value, onSave, 700);
  return <input {...rest} className={cx('input', className)} value={v} onChange={(e) => setV(e.target.value)} onBlur={flush} />;
}

export function Check({ checked, onChange, children, label }: { checked: boolean; onChange: (v: boolean) => void; children?: React.ReactNode; label?: string }) {
  return (
    <label className={cx('check', checked && 'check--done')}>
      <input type="checkbox" className="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      {children && <span className="check__text">{children}</span>}
    </label>
  );
}

/** 체크리스트 편집기: 프리셋 칩, 추가, 삭제, 체크 */
export function Checklist({
  items,
  onChange,
  presets = [],
  placeholder = '항목 추가',
}: {
  items: CheckItem[];
  onChange: (items: CheckItem[]) => void;
  presets?: string[];
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const add = (t: string) => {
    const v = t.trim();
    if (!v) return;
    onChange([...items, { id: uuid(), text: v, done: false }]);
  };
  const unusedPresets = presets.filter((p) => !items.some((i) => i.text === p));
  return (
    <div className="checklist">
      <ul className="list-reset">
        {items.map((it) => (
          <li key={it.id} className="checklist__item">
            <Check checked={it.done} onChange={(done) => onChange(items.map((x) => (x.id === it.id ? { ...x, done } : x)))}>
              {it.text}
            </Check>
            <button className="icon-btn checklist__remove" onClick={() => onChange(items.filter((x) => x.id !== it.id))} aria-label={`${it.text} 삭제`}>
              <X size={16} />
            </button>
          </li>
        ))}
      </ul>
      {unusedPresets.length > 0 && (
        <div className="row row--wrap checklist__presets">
          {unusedPresets.map((p) => (
            <button key={p} className="chip" onClick={() => add(p)}>
              <Plus size={12} /> {p}
            </button>
          ))}
        </div>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          add(text);
          setText('');
          inputRef.current?.focus();
        }}
      >
        <input ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} enterKeyHint="done" />
        <button className="icon-btn icon-btn--outline" type="submit" aria-label="추가" disabled={!text.trim()}>
          <Plus size={20} />
        </button>
      </form>
    </div>
  );
}
