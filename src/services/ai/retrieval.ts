import type { Settings } from '../../types';
import { buildCorpus, type RecordDoc } from './corpus';
import { describeQuery, parseQuery, type ParsedQuery } from './query';
import { todayISO } from '../../utils/date';

// 질문 → 조건 해석 → 실제 기록 검색. AI는 여기서 찾은 기록만 근거로 답한다.

export interface SearchHit {
  doc: RecordDoc;
  score: number;
  matched: string[];
}

export interface RetrievalResult {
  query: ParsedQuery;
  conditions: string; // 사람이 읽는 검색 조건
  hits: SearchHit[];
  corpusSize: number;
  structural: boolean; // 날짜 · 학년 · 반 · 종류 · 상태 조건이 있었는지
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

function inRange(d: RecordDoc, from: string, to: string) {
  const ds = [d.date, ...(d.dates ?? [])].filter(Boolean) as string[];
  return ds.some((x) => x >= from && x <= to);
}

function passFilters(d: RecordDoc, q: ParsedQuery): boolean {
  if (q.range && !inRange(d, q.range.from, q.range.to)) return false;
  const hay = `${d.title} ${d.text}`;
  if (q.classes.length) {
    const ok = q.classes.some((c) => d.classKey === c || hay.includes(c) || hay.includes(`${c.split('-')[0]}학년 ${c.split('-')[1]}반`));
    if (!ok) return false;
  } else if (q.grades.length) {
    const ok = q.grades.some((g) => d.grade === g || d.classKey?.startsWith(`${g}-`) || hay.includes(`${g}학년`) || new RegExp(`(^|[^\\d])${g}-\\d`).test(hay));
    if (!ok) return false;
  }
  if (q.kinds.length) {
    const ok = q.kinds.includes(d.kind) || (q.irregular && !!d.irregular);
    if (!ok) return false;
  }
  // "정규 시간표와 다른 수업"을 물으면 수업 · 시간표 변경 기록은 실제로 달랐던 것만
  if (q.irregular && (d.kind === 'lesson' || d.kind === 'change' || !q.kinds.length) && !d.irregular) return false;
  if (q.status && d.done !== undefined) {
    if (q.status === 'open' && d.done) return false;
    if (q.status === 'done' && !d.done) return false;
  }
  if (q.phrases.length && !q.phrases.every((p) => squash(hay).includes(squash(p)))) return false;
  return true;
}

function keywordHits(d: RecordDoc, words: string[]): { score: number; matched: string[] } {
  const title = squash(d.title);
  const body = squash(d.text);
  let score = 0;
  const matched: string[] = [];
  for (const w of words) {
    const k = squash(w);
    let hit = body.includes(k) || title.includes(k);
    // 부분 일치: "시장놀이를"처럼 조사가 남았거나 어미가 다른 경우 앞부분으로 한 번 더 본다
    if (!hit && k.length >= 3) hit = body.includes(k.slice(0, -1)) || title.includes(k.slice(0, -1));
    if (hit) {
      matched.push(w);
      score += 1 + (title.includes(k) ? 1 : 0) + Math.min(2, (body.split(k).length - 2) * 0.3);
    }
  }
  return { score, matched };
}

export async function retrieve(s: Settings, question: string, opts: { today?: string; corpus?: RecordDoc[] } = {}): Promise<RetrievalResult> {
  const today = opts.today ?? todayISO();
  const q = parseQuery(question, today);
  const corpus = opts.corpus ?? (await buildCorpus(s));
  const structural = !!(q.range || q.grades.length || q.classes.length || q.kinds.length || q.status || q.irregular || q.phrases.length);
  const hits: SearchHit[] = [];

  if (!structural && !q.keywords.length) {
    if (!q.wantsAll) return { query: q, conditions: describeQuery(q), hits: [], corpusSize: corpus.length, structural };
  }

  for (const d of corpus) {
    if (!passFilters(d, q)) continue;
    const hard = keywordHits(d, q.keywords);
    const soft = keywordHits(d, q.soft);
    hits.push({ doc: d, score: hard.score * 3 + soft.score, matched: [...hard.matched, ...soft.matched] });
  }

  let result = hits;
  if (q.keywords.length) {
    const withHits = hits.filter((h) => h.matched.some((m) => q.keywords.includes(m)));
    if (structural) {
      // 조건이 있으면: 키워드가 맞는 기록이 있으면 그것만, 없으면 조건에 맞는 기록 전체를 AI가 판단하게 둔다
      if (withHits.length) result = withHits;
    } else {
      // 조건 없이 키워드만: 키워드 절반 이상이 맞는 기록만
      const need = Math.max(1, Math.ceil(q.keywords.length / 2));
      result = hits.filter((h) => h.matched.filter((m) => q.keywords.includes(m)).length >= need);
    }
  }
  result.sort((a, b) => b.score - a.score || (b.doc.date ?? '').localeCompare(a.doc.date ?? ''));
  return { query: q, conditions: describeQuery(q), hits: result, corpusSize: corpus.length, structural };
}

/**
 * 요약용: 날짜 · 학년/반 · 종류 · 상태 조건에 맞는 기록을 "모두" 모은다(순위로 자르지 않음).
 * 키워드가 있으면 키워드가 맞는 기록으로 좁히되, 하나도 안 맞으면 조건 범위 전체를 쓴다.
 */
export function collectInScope(corpus: RecordDoc[], q: ParsedQuery): RecordDoc[] {
  const inScope = corpus.filter((d) => passFilters(d, q));
  if (!q.keywords.length) return inScope;
  const hit = inScope.filter((d) => keywordHits(d, q.keywords).matched.length > 0);
  return hit.length ? hit : inScope;
}
