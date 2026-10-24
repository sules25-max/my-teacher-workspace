import { callAppsScript, AppsScriptError } from '../google/appsScriptClient';
import type { Settings } from '../../types';
import { todayISO } from '../../utils/date';
import { uuid } from '../../utils/id';

// 이미지 분석. 원본 파일과 "AI 전송용 사본"을 분리한다.
// - 전송용: 긴 변 1600px 이하 JPEG(메모리에서만 만들고 버림). 업무 데이터 · localStorage에 넣지 않는다.
// - 원본: 사용자가 저장 액션을 고를 때만 기존 첨부 구조(IndexedDB Blob → Drive)로 저장한다.

export const MAX_IMAGES = 3; // Groq qwen/qwen3.8-27b 요청당 이미지 수
export const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;
const MAX_EDGE = 1600;
const TARGET_BASE64 = 3_000_000; // 전송용 base64 상한(요청 크기 여유)

const ACCEPT = /^image\/(jpeg|jpg|png|webp|gif|bmp|heic|heif|avif)$/i;

export class VisionError extends Error {
  constructor(
    public code: 'unsupported' | 'too-large' | 'decode' | 'model' | 'rate-limit' | 'network' | 'no-ai',
    message: string,
  ) {
    super(message);
  }
}

export interface PreparedImage {
  id: string;
  file: File; // 원본(저장할 때만 사용)
  previewUrl: string;
  base64: string; // 전송용 사본
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  sentBytes: number;
}

async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file);
  } catch {
    // 일부 형식(HEIC 등)은 <img>로만 열리는 브라우저가 있다
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new VisionError('decode', `"${file.name}"을(를) 열 수 없어요. 사진 앱에서 JPEG/PNG로 저장한 뒤 다시 넣어 주세요.`);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ACCEPT.test(file.type || '') && !/\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(file.name)) {
    throw new VisionError('unsupported', `"${file.name}"은(는) 지원하지 않는 형식이에요. JPG · PNG · WEBP · GIF · HEIC 사진을 넣어 주세요.`);
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new VisionError('too-large', `"${file.name}"이(가) 너무 커요(${Math.round(file.size / 1024 / 1024)}MB). 30MB 이하로 넣어 주세요.`);
  }
  const src = await decode(file);
  let edge = MAX_EDGE;
  let quality = 0.86;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, edge / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; // 투명 PNG는 흰 바탕으로
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    const base64 = c.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
    if (base64.length <= TARGET_BASE64 || attempt === 5) {
      return { id: uuid(), file, previewUrl: URL.createObjectURL(file), base64, mimeType: 'image/jpeg', width: w, height: h, sentBytes: Math.round((base64.length * 3) / 4) };
    }
    quality -= 0.12;
    edge = Math.round(edge * 0.8);
  }
  throw new VisionError('too-large', '이미지를 전송 가능한 크기로 줄이지 못했어요.');
}

export interface VisionExtract {
  todos: { title: string; due?: string | null }[];
  events: { title: string; date?: string | null; time?: string | null }[];
  materials: string[];
  summary?: string;
  unreadable?: boolean;
}

export interface VisionResult {
  text: string; // 사용자에게 보여줄 답변(JSON 블록 제외)
  extract: VisionExtract;
  provider?: string;
  model?: string;
  fallback?: boolean;
}

const SYSTEM = (today: string) =>
  [
    '너는 초등 교사의 업무수첩 비서 "AI 이나"야. 사용자가 보낸 이미지를 분석해.',
    '이미지에 실제로 보이는 내용만 근거로 답해. 보이지 않는 내용은 추측하거나 지어내지 마.',
    '글자를 확실히 읽지 못한 부분은 "(판독 불확실: …)"처럼 표시해. 흐리거나 글자가 거의 없어 판단하기 어려우면 그렇다고 말해.',
    '친근한 반말로 질문에 맞게 답해(필요하면 "- " 목록).',
    `오늘 날짜는 ${today}야. 이미지 속 날짜에 연도가 없으면 오늘 기준으로 가까운 날짜로 적어.`,
    '답변 뒤에 반드시 다음 형식의 JSON을 ```json 코드블록 하나로 붙여. 이미지에 없는 항목은 빈 배열로 둬:',
    '{"todos":[{"title":"할 일","due":"YYYY-MM-DD 또는 null"}],"events":[{"title":"일정","date":"YYYY-MM-DD 또는 null","time":"HH:MM 또는 null"}],"materials":["준비물"],"summary":"기록에 남길 한두 문장","unreadable":false}',
  ].join(' ');

function parseExtract(raw: string): { text: string; extract: VisionExtract } {
  const empty: VisionExtract = { todos: [], events: [], materials: [] };
  const m = raw.match(/```json\s*([\s\S]*?)```/i) ?? raw.match(/(\{[\s\S]*"todos"[\s\S]*\})\s*$/);
  const text = raw.replace(/```json[\s\S]*?```/i, '').trim();
  if (!m) return { text: raw.trim(), extract: empty };
  try {
    const j = JSON.parse(m[1]) as Partial<VisionExtract>;
    const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
    return {
      text: text || raw.trim(),
      extract: {
        todos: (j.todos ?? []).map((t) => ({ title: str(t?.title), due: /^\d{4}-\d{2}-\d{2}$/.test(str(t?.due)) ? str(t?.due) : null })).filter((t) => t.title),
        events: (j.events ?? []).map((e) => ({ title: str(e?.title), date: /^\d{4}-\d{2}-\d{2}$/.test(str(e?.date)) ? str(e?.date) : null, time: /^\d{1,2}:\d{2}$/.test(str(e?.time)) ? str(e?.time) : null })).filter((e) => e.title),
        materials: (j.materials ?? []).map(str).filter(Boolean),
        summary: str(j.summary),
        unreadable: !!j.unreadable,
      },
    };
  } catch {
    return { text: text || raw.trim(), extract: empty };
  }
}

export async function analyzeImages(s: Settings, question: string, images: PreparedImage[]): Promise<VisionResult> {
  if (s.ai.provider === 'local') throw new VisionError('no-ai', '이미지 분석은 외부 AI 연결이 필요해요. 설정 → AI 비서에서 Groq를 골라 주세요.');
  if (!navigator.onLine) throw new VisionError('network', '인터넷에 연결되어 있지 않아요. 연결된 뒤 다시 보내 주세요(이미지는 그대로 붙어 있어요).');
  try {
    const res = await callAppsScript<{ text: string; provider?: string; model?: string; fallback?: boolean }>(
      'aiVision',
      {
        provider: s.ai.provider,
        question,
        system: SYSTEM(todayISO()),
        images: images.slice(0, MAX_IMAGES).map((i) => ({ mimeType: i.mimeType, base64: i.base64 })),
      },
      undefined,
      120000,
    );
    const parsed = parseExtract(res.text);
    return { ...parsed, provider: res.provider, model: res.model, fallback: res.fallback };
  } catch (e) {
    const msg = (e as Error).message;
    if (/동기화가 설정되지 않았어요/.test(msg)) throw new VisionError('no-ai', '이미지 분석은 Google 동기화(Apps Script) 연결이 필요해요. 설정 → Google 동기화에서 연결해 주세요.');
    if (/알 수 없는 요청/.test(msg)) throw new VisionError('model', 'Apps Script가 예전 코드예요. 최신 Code.gs를 붙여 넣고 새 버전으로 배포해 주세요.');
    if (/429|rate|limit|한도/i.test(msg)) throw new VisionError('rate-limit', 'AI 사용 한도에 걸렸어요. 1분쯤 뒤에 다시 보내 주세요.');
    if (/413|too large|payload|크기/i.test(msg)) throw new VisionError('too-large', '이미지가 너무 커서 AI가 받지 못했어요. 이미지를 줄이거나 한 장씩 보내 주세요.');
    if (e instanceof AppsScriptError && /연결할 수 없어요|시간이 초과/.test(msg)) throw new VisionError('network', `${msg} (이미지는 그대로 붙어 있어요)`);
    throw new VisionError('model', `이미지 분석 모델 오류: ${msg}`);
  }
}
