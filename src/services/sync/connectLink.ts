// 한 번 연결한 Google 동기화를 다른 기기 · 다른 주소에서 그대로 쓰기 위한 "연결 코드".
// 토큰을 앱 코드(공개 GitHub Pages)에 넣지 않고, 사용자가 가진 기기끼리만 링크/QR/코드로 옮긴다.
// 해시(#) 뒤에 담기 때문에 웹 서버로는 전송되지 않으며, 열자마자 주소창 기록에서 지운다.

export interface ConnectInfo {
  endpoint: string;
  token: string;
}

const PREFIX = 'MTW1.';

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeConnectCode(info: ConnectInfo): string {
  return PREFIX + toBase64Url(JSON.stringify({ e: info.endpoint, t: info.token }));
}

/** 연결 코드 또는 연결 링크 전체를 받아 해석한다. */
export function decodeConnectCode(input: string): ConnectInfo | null {
  const raw = input.trim();
  const m = raw.match(/MTW1\.[A-Za-z0-9_-]+/);
  if (!m) return null;
  try {
    const j = JSON.parse(fromBase64Url(m[0].slice(PREFIX.length))) as { e?: string; t?: string };
    if (!j.e || !j.t || !/^https:\/\/script\.google(usercontent)?\.com\//.test(j.e)) return null;
    return { endpoint: j.e, token: j.t };
  } catch {
    return null;
  }
}

/** 지금 열려 있는 앱 주소(GitHub Pages든 localhost든) 기준의 연결 링크 */
export function buildConnectLink(info: ConnectInfo): string {
  return `${location.origin}${location.pathname}#/connect/${encodeConnectCode(info)}`;
}
