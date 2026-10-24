import type { AIProvider } from './provider';
import type { RecordDoc } from './corpus';
import { KIND_LABEL } from './query';

// 기록이 많아도 버리지 않는 단계적(Map-Reduce) 요약.
// 원본 기록 → 여러 묶음으로 나눔 → 묶음별 요약(map) → 중간 요약 통합(reduce) → 최종 요약
// "분석한 기록 수"는 실제로 AI가 성공적으로 읽은 묶음에 들어 있던 기록만 센다.

export const CHUNK_CHARS = 7000; // 한 번의 요청에 넣는 기록 분량(Groq 무료 한도 안쪽)
const GAP_MS = 1200; // 연속 요청 사이 간격(요청 한도 보호)

export const DEFAULT_SECTIONS = ['완료한 일', '미완료 업무', '예정된 일', '수업 관련 기록', '학생/학급 관련 메모', '회의 및 행정업무', '아이디어', '후속 조치가 필요한 내용'];

export interface SummaryProgress {
  stage: 'map' | 'reduce';
  done: number;
  total: number;
}

export interface SummaryResult {
  text: string;
  total: number; // 범위 안의 전체 기록 수
  analyzed: number; // 실제로 AI가 읽은 기록 수
  chunks: number;
  failedChunks: number;
  calls: number;
  sentChars: number;
  usedKeys: string[];
}

interface Piece {
  key: string; // 원본 기록 key
  part: number;
  parts: number;
  text: string;
}

export function formatDocForAI(d: RecordDoc, n?: number): string {
  return `${n !== undefined ? `[${n}] ` : ''}${d.date ?? '날짜 없음'} / ${KIND_LABEL[d.kind]} / ${d.title}\n${d.text}`;
}

/** 기록을 묶음으로 나눈다. 아주 긴 기록 하나는 잘라서 여러 묶음에 나눠 넣는다(버리지 않음). */
export function chunkDocs(docs: RecordDoc[], size = CHUNK_CHARS): Piece[][] {
  const pieces: Piece[] = [];
  for (const d of docs) {
    const full = formatDocForAI(d);
    if (full.length <= size) {
      pieces.push({ key: d.key, part: 1, parts: 1, text: full });
      continue;
    }
    const parts = Math.ceil(full.length / (size - 200));
    for (let i = 0; i < parts; i++) {
      pieces.push({ key: d.key, part: i + 1, parts, text: `${i ? `(이어서 ${i + 1}/${parts}) ` : ''}${full.slice(i * (size - 200), (i + 1) * (size - 200))}` });
    }
  }
  const chunks: Piece[][] = [];
  let cur: Piece[] = [];
  let len = 0;
  for (const p of pieces) {
    if (cur.length && len + p.text.length > size) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(p);
    len += p.text.length + 2;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const clean = (t: string) =>
  t
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/\n*\((Groq|Gemini|OpenAI) 대신 [^)]+로 답했어\)\s*$/, '')
    .trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callWithRetry(provider: AIProvider, system: string, context: string, ask: string, maxTokens: number): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = clean(await provider.chat([{ role: 'user', content: ask }], { label: '요약', text: context }, { system, maxTokens }));
      if (!text) throw new Error('빈 응답');
      return text;
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message;
      // 요청 한도(429)면 조금 더 기다렸다가 다시
      await sleep(/429|rate|한도|limit/i.test(msg) ? 8000 * (attempt + 1) : 2500 * (attempt + 1));
    }
  }
  throw lastErr;
}

export interface SummarizeOptions {
  scopeLabel: string; // "이번 주", "2026년 10월" …
  sections?: string[];
  extraRules?: string;
  onProgress?: (p: SummaryProgress) => void;
}

export async function summarizeDocs(provider: AIProvider, docs: RecordDoc[], opts: SummarizeOptions): Promise<SummaryResult> {
  const sections = opts.sections ?? DEFAULT_SECTIONS;
  const sectionRule = `아래 제목 순서로 정리하고, 해당 내용이 기록에 없는 제목은 통째로 생략해: ${sections.map((x) => `「${x}」`).join(', ')}.`;
  const base = [
    '너는 초등 교사의 업무수첩을 정리하는 비서야.',
    '주어진 [기록]에 실제로 적힌 내용만 사용해. 기록에 없는 사실 · 숫자 · 이름 · 날짜를 추측하거나 만들어 내지 마.',
    '중요한 내용을 빠뜨리지 말고, 각 항목 끝에 근거 날짜를 (10/14)처럼 붙여.',
    '한국어로, 제목은 "## 제목", 항목은 "- "로 써.',
    opts.extraRules ?? '',
  ].join(' ');

  const total = docs.length;
  const chunks = chunkDocs(docs);
  const partials: string[] = [];
  const okKeys = new Map<string, number>(); // 기록 key → 성공한 조각 수
  const partsOf = new Map<string, number>();
  chunks.flat().forEach((p) => partsOf.set(p.key, p.parts));
  let failedChunks = 0;
  let calls = 0;
  let sentChars = 0;

  for (let i = 0; i < chunks.length; i++) {
    opts.onProgress?.({ stage: 'map', done: i, total: chunks.length });
    const ctx = `요약 범위: ${opts.scopeLabel}\n[기록] (${chunks.length}묶음 중 ${i + 1}번째)\n\n${chunks[i].map((p) => p.text).join('\n\n')}`;
    try {
      const single = chunks.length === 1;
      const text = await callWithRetry(
        provider,
        `${base} ${single ? sectionRule : '이 묶음의 기록을 빠짐없이 요약해. 나중에 다른 묶음과 합칠 거라 제목별로 정리해.'} ${sectionRule}`,
        ctx,
        single ? `${opts.scopeLabel} 기록을 정리해 줘.` : `이 묶음(${i + 1}/${chunks.length})의 기록을 요약해 줘.`,
        1600,
      );
      calls++;
      sentChars += ctx.length;
      partials.push(text);
      chunks[i].forEach((p) => okKeys.set(p.key, (okKeys.get(p.key) ?? 0) + 1));
    } catch {
      failedChunks++;
    }
    if (i < chunks.length - 1) await sleep(GAP_MS);
  }

  // 모든 조각이 성공한 기록만 "분석됨"으로 센다
  const usedKeys = [...okKeys.entries()].filter(([k, n]) => n === partsOf.get(k)).map(([k]) => k);
  const analyzed = usedKeys.length;
  if (!partials.length) throw new Error('요약 요청이 모두 실패했어요.');

  // reduce: 중간 요약이 여러 개면 한 번에 들어갈 만큼씩 합치기를 반복
  let layer = partials;
  let round = 0;
  while (layer.length > 1) {
    round++;
    const groups: string[][] = [];
    let cur: string[] = [];
    let len = 0;
    for (const p of layer) {
      if (cur.length && len + p.length > CHUNK_CHARS) {
        groups.push(cur);
        cur = [];
        len = 0;
      }
      cur.push(p);
      len += p.length;
    }
    if (cur.length) groups.push(cur);
    const next: string[] = [];
    for (let g = 0; g < groups.length; g++) {
      opts.onProgress?.({ stage: 'reduce', done: g, total: groups.length });
      const ctx = `요약 범위: ${opts.scopeLabel}\n[중간 요약 ${groups[g].length}개]\n\n${groups[g].map((t, i) => `--- 중간 요약 ${i + 1} ---\n${t}`).join('\n\n')}`;
      const text = await callWithRetry(
        provider,
        `${base} 아래 [중간 요약]들은 같은 범위의 기록을 나눠 요약한 거야. 중간 요약에 있는 내용만 합치고, 중복은 하나로 묶어. 새 내용을 더하지 마. ${sectionRule}`,
        ctx,
        `${opts.scopeLabel} 중간 요약들을 하나로 통합해 줘.`,
        2000,
      );
      calls++;
      sentChars += ctx.length;
      next.push(text);
      if (g < groups.length - 1) await sleep(GAP_MS);
    }
    layer = next;
    if (round > 4) break;
  }

  return { text: layer[0], total, analyzed, chunks: chunks.length, failedChunks, calls, sentChars, usedKeys };
}
