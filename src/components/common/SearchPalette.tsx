import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { searchAll, KIND_LABEL, type SearchResult } from '../../services/search';
import { navigate } from '../../hooks/useRoute';
import { openLesson } from '../planner/lessonDrawerStore';
import { NAV, SETTINGS_NAV } from '../layout/nav';
import { formatShort } from '../../utils/date';
import { cx } from '../../utils/id';

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setResults([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const r = q.trim() ? await searchAll(q.trim()) : [];
      if (alive) {
        setResults(r);
        setActive(0);
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const commands: Command[] = useMemo(
    () =>
      [...NAV, SETTINGS_NAV]
        .filter((n) => !q.trim() || `${n.label} ${n.ko}`.toLowerCase().includes(q.trim().toLowerCase()))
        .map((n) => ({ id: `nav:${n.route}`, label: `${n.label} · ${n.ko}`, hint: '이동', run: () => navigate(n.route) })),
    [q],
  );

  const items: { key: string; run: () => void }[] = [
    ...results.map((r) => ({ key: `${r.kind}:${r.id}`, run: () => (r.kind === 'lesson' ? openLesson({ recordId: r.id }) : r.href && navigate(r.href)) })),
    ...commands.map((c) => ({ key: c.id, run: c.run })),
  ];

  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    onClose();
    it.run();
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="overlay overlay--top" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="전체 검색">
        <div className="palette__input-row">
          <Search size={20} aria-hidden="true" />
          <input
            ref={inputRef}
            className="palette__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="수업메모 · 회의 · 페이지 · 할 일 · 일정 검색"
            aria-label="검색어"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `pal-${active}` : undefined}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(active);
              } else if (e.key === 'Escape') onClose();
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <ul className="palette__list list-reset" id="palette-list" role="listbox" ref={listRef}>
          {q.trim() && results.length === 0 && <li className="palette__empty muted">“{q}”에 맞는 기록이 없어요.</li>}
          {results.map((r, i) => (
            <li key={`${r.kind}:${r.id}`} id={`pal-${i}`} data-idx={i} role="option" aria-selected={active === i}>
              <button className={cx('palette__item', active === i && 'is-active')} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
                <span className="stamp stamp--blue palette__kind">{KIND_LABEL[r.kind]}</span>
                <span className="palette__body">
                  <span className="palette__title">{r.title}</span>
                  {r.snippet && <span className="palette__snippet">{r.snippet}</span>}
                </span>
                {r.date && <span className="palette__date muted">{formatShort(r.date)}</span>}
              </button>
            </li>
          ))}
          {commands.length > 0 && <li className="palette__section muted">바로가기</li>}
          {commands.map((c, j) => {
            const i = results.length + j;
            return (
              <li key={c.id} id={`pal-${i}`} data-idx={i} role="option" aria-selected={active === i}>
                <button className={cx('palette__item', active === i && 'is-active')} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
                  <span className="palette__body">
                    <span className="palette__title">{c.label}</span>
                  </span>
                  <span className="muted">{c.hint}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>,
    document.body,
  );
}
