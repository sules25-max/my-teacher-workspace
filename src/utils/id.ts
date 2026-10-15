/** crypto.randomUUID는 보안 컨텍스트(https/localhost)에서만 존재하므로 LAN 접속용 대체 구현을 둔다. */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      /* fallthrough */
    }
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const nowISO = () => new Date().toISOString();

export function classKey(grade: number, classNumber: number): string {
  return `${grade}-${classNumber}`;
}

export function parseClassKey(key: string): { grade: number; classNumber: number } {
  const [g, c] = key.split('-').map(Number);
  return { grade: g, classNumber: c };
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a: A) => {
    if (t) clearTimeout(t);
    fn(...a);
  };
  return d;
}

export function snippet(text: string, query: string, len = 60): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!query) return t.slice(0, len);
  const i = t.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return t.slice(0, len);
  const start = Math.max(0, i - 20);
  return (start > 0 ? '…' : '') + t.slice(start, start + len) + (start + len < t.length ? '…' : '');
}
