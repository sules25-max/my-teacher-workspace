import { useCallback, useEffect, useRef, useState } from 'react';
import { onFlushRequest } from '../services/flush';

/**
 * 입력 중에는 로컬 상태만 바꾸고, 멈춘 뒤 ms 후 저장한다.
 * key가 바뀌거나 컴포넌트가 사라질 때는 남은 변경을 즉시 저장한다.
 */
export function useAutosave<T>(key: string, external: T, save: (v: T) => void | Promise<void>, ms = 800) {
  const [value, setValue] = useState<T>(external);
  const pending = useRef(false);
  const latest = useRef(value);
  const saveRef = useRef(save);
  saveRef.current = save;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!pending.current) {
      setValue(external);
      latest.current = external;
    }
  }, [external]);

  useEffect(() => {
    setValue(external);
    latest.current = external;
    pending.current = false;
    return () => {
      if (pending.current) {
        clearTimeout(timer.current);
        pending.current = false;
        void saveRef.current(latest.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const change = useCallback(
    (v: T) => {
      setValue(v);
      latest.current = v;
      pending.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        pending.current = false;
        void saveRef.current(latest.current);
      }, ms);
    },
    [ms],
  );

  const flush = useCallback(() => {
    if (!pending.current) return;
    clearTimeout(timer.current);
    pending.current = false;
    return saveRef.current(latest.current);
  }, []);

  // 새 버전 적용 · 앱 숨김 · 페이지 닫기 직전에 대기 중인 입력을 바로 저장한다
  useEffect(() => onFlushRequest(flush), [flush]);

  return [value, change, flush] as const;
}
