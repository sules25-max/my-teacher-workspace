import { db } from '../localDb';

// Google Apps Script 웹 앱과 통신하는 얇은 클라이언트.
// - CORS preflight를 피하려고 text/plain 으로 JSON을 보낸다.
// - 토큰은 사용자가 설정에서 입력하고 IndexedDB에만 저장한다(코드에 하드코딩하지 않음).

export class AppsScriptError extends Error {}

export interface AppsScriptConfig {
  endpoint: string;
  token: string;
}

export async function getAppsScriptConfig(): Promise<AppsScriptConfig | null> {
  const s = await db.settings.get('main');
  if (!s || s.sync.mode !== 'appsScript' || !s.sync.endpoint || !s.sync.token) return null;
  return { endpoint: s.sync.endpoint, token: s.sync.token };
}

export async function callAppsScript<T = unknown>(
  action: string,
  payload: unknown = {},
  config?: AppsScriptConfig | null,
  timeoutMs = 30000,
): Promise<T> {
  const cfg = config ?? (await getAppsScriptConfig());
  if (!cfg) throw new AppsScriptError('Google 동기화가 설정되지 않았어요.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: cfg.token, action, payload }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new AppsScriptError(`서버 응답 오류 (${res.status})`);
    const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
    if (!json.ok) throw new AppsScriptError(json.error || '알 수 없는 오류');
    return json.data as T;
  } catch (e) {
    if (e instanceof AppsScriptError) throw e;
    if ((e as Error).name === 'AbortError') throw new AppsScriptError('응답 시간이 초과됐어요.');
    throw new AppsScriptError('Apps Script에 연결할 수 없어요. 주소와 배포 설정을 확인해 주세요.');
  } finally {
    clearTimeout(timer);
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64: string, mimeType: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
