import type { Settings } from '../../types';
import type { AIMessage, AIProvider } from './provider';
import { collectInScope, retrieve, type RetrievalResult } from './retrieval';
import { buildCorpus, type RecordDoc } from './corpus';
import { KIND_LABEL, describeQuery, parseQuery, type DateRange } from './query';
import { formatDocForAI, summarizeDocs, type SummaryProgress } from './summarize';
import { addDays, startOfWeek, todayISO } from '../../utils/date';

// AI 답변은 "먼저 실제 기록을 검색 → 관련 기록이 있으면 그 기록을 근거로 답"한다.
// 관련 기록이 없거나 기록과 상관없는 질문이면 AI가 일반 지식으로 답한다(기록 내용은 지어내지 않음).
// AI가 없을 때(기기 안 검색)는 찾은 기록만 보여주고, 없으면 "관련 기록을 찾지 못했습니다."

export const NOT_FOUND = '관련 기록을 찾지 못했습니다.';
const ANSWER_BUDGET = 14000; // 한 번의 답변 요청에 넣는 기록 분량(글자)
export const GENERAL_FOOTER = '내 기록 없이 AI 일반 답변';

export interface UsedRecord {
  key: string;
  date?: string;
  kind: string;
  title: string;
  href?: string;
  lessonRecordId?: string;
}

export interface AIDebug {
  mode: 'answer' | 'summary' | 'list' | 'none' | 'general';
  conditions: string;
  matched: number; // 조건에 맞은 기록 수
  used: UsedRecord[]; // 실제로 AI에게 보낸 기록
  corpusSize: number;
  sentChars: number;
  calls: number;
  note?: string;
}

export interface GroundedReply {
  text: string;
  debug: AIDebug;
  footer?: string; // "총 43개 기록 중 43개 분석"
  sources: UsedRecord[];
}

export const toUsed = (d: RecordDoc): UsedRecord => ({ key: d.key, date: d.date, kind: KIND_LABEL[d.kind], title: d.title, href: d.href, lessonRecordId: d.lessonRecordId });

const ANSWER_SYSTEM = [
  '너는 초등 교사의 개인 업무수첩 안에 사는 비서 "AI 이나"야.',
  '아래 [기록]은 사용자의 실제 업무수첩에서 질문과 관련 있어 보이는 것을 찾아 온 것이야.',
  '질문이 사용자의 기록(수업 · 회의 · 할 일 · 일정 · 메모 등)에 관한 것이면 [기록]에 적힌 내용만 근거로 답하고, 사용한 기록은 문장 끝에 [번호]로 표시해. 날짜 · 학년/반 · 차시는 기록에 적힌 그대로 써.',
  '[기록]에 답이 없거나 질문이 기록과 상관없는 일반 질문(수업 아이디어 · 글쓰기 · 설명 · 상담 등)이면, 일반 지식으로 성실하게 답해. 이때 "기록에는 없지만"처럼 기록에서 온 내용이 아님을 밝히고, 사용자의 기록 내용(날짜 · 반 · 있었던 일)은 절대 지어내지 마.',
  '친근한 반말로, 필요하면 목록으로 정리해. 데이터를 직접 바꿀 수는 없어.',
].join(' ');

const GENERAL_SYSTEM = [
  '너는 초등 교사의 개인 업무수첩 안에 사는 비서 "AI 이나"야. 친근한 반말로 답해.',
  '수업 아이디어 · 활동 · 학급 운영 · 업무 문서 작성 · 학부모 상담 · 영어 표현 · 일반 상식 등 무엇이든 성실하고 구체적으로 도와줘. 필요하면 목록으로 정리해.',
  '사용자의 업무수첩 기록은 이번 질문에 함께 오지 않았어. 사용자의 기록 내용(날짜 · 반 · 있었던 일)을 아는 척하거나 지어내지 마.',
  '확실하지 않은 사실은 확실하지 않다고 말해. 데이터를 직접 바꿀 수는 없어.',
].join(' ');

/** 사용자의 기록을 찾는 질문인지(날짜 · 반 · "찾아/기록/메모/언제/했던" 등). "수업" "4학년"만으로는 일반 질문일 수 있어 보지 않는다 */
export function isRecordQuestion(question: string, today = todayISO()): boolean {
  const p = parseQuery(question, today);
  return !!(p.range || p.classes.length || p.status || p.irregular || p.phrases.length) || /찾아|기록|메모|적어\s*둔|적었|저장한|언제|했던|했었|지난번|목록/.test(question);
}

/** 기록 없이 AI가 일반 지식으로 답한다. 기록을 찾는 질문이었으면 못 찾았다는 사실을 먼저 알린다 */
export async function askGeneral(provider: AIProvider, question: string, history: AIMessage[], opts: { recordMiss?: boolean; conditions?: string; corpusSize?: number } = {}): Promise<GroundedReply> {
  const system = opts.recordMiss
    ? `${GENERAL_SYSTEM} 이번 질문과 관련된 기록을 사용자의 업무수첩에서 찾지 못했어. 첫 문장에서 "업무수첩에서는 관련 기록을 못 찾았어"라고 짧게 알린 뒤, 일반적으로 도움이 될 답을 해.`
    : GENERAL_SYSTEM;
  const text = clean(await provider.chat([...history.slice(-6), { role: 'user', content: question }], null, { system, maxTokens: 1400 }));
  return {
    text: text || '답을 만들지 못했어. 다시 한 번 물어봐 줄래?',
    footer: opts.recordMiss ? `관련 기록 없음 · ${GENERAL_FOOTER}` : GENERAL_FOOTER,
    sources: [],
    debug: { mode: 'general', conditions: opts.conditions ?? '-', matched: 0, used: [], corpusSize: opts.corpusSize ?? 0, sentChars: 0, calls: 1, note: '기록 전송 없음' },
  };
}

const clean = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/** 요약 범위가 질문에 없을 때의 기본값: 이번 주 */
function defaultRange(today: string): DateRange {
  const ws = startOfWeek(today);
  return { from: ws, to: addDays(ws, 6), label: '이번 주' };
}

export async function askWithRecords(
  s: Settings,
  provider: AIProvider | null,
  question: string,
  history: AIMessage[],
  onProgress?: (msg: string) => void,
): Promise<GroundedReply> {
  const today = todayISO();
  const corpus = await buildCorpus(s);
  const parsed = parseQuery(question, today);

  // ---------- 요약 요청: 범위 안의 기록을 "모두" 모아 단계적으로 요약 ----------
  if (parsed.wantsSummary) {
    const q = parsed.range || parsed.wantsAll ? parsed : { ...parsed, range: defaultRange(today) };
    const docs = collectInScope(corpus, q).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const scopeLabel = [q.range?.label ?? (parsed.wantsAll ? '전체 기록' : ''), ...parsed.grades.map((g) => `${g}학년`), ...parsed.classes, ...parsed.kinds.map((k) => KIND_LABEL[k])].filter(Boolean).join(' · ') || '전체 기록';
    const conditions = describeQuery(q);
    if (!docs.length) {
      return { text: NOT_FOUND, sources: [], debug: { mode: 'none', conditions, matched: 0, used: [], corpusSize: corpus.length, sentChars: 0, calls: 0 } };
    }
    if (!provider) {
      return localList(docs, conditions, corpus.length, `AI를 연결하면 이 ${docs.length}개 기록을 요약해 드려요. 지금은 목록만 보여 드릴게요.`);
    }
    const res = await summarizeDocs(provider, docs, {
      scopeLabel,
      onProgress: (p: SummaryProgress) =>
        onProgress?.(p.stage === 'map' ? `기록 ${docs.length}개를 ${p.total}묶음으로 나눠 읽는 중… (${p.done + 1}/${p.total})` : `중간 요약을 합치는 중… (${p.done + 1}/${p.total})`),
    });
    const used = docs.filter((d) => res.usedKeys.includes(d.key)).map(toUsed);
    return {
      text: res.text,
      footer: `총 ${res.total}개 기록 중 ${res.analyzed}개 분석${res.failedChunks ? ` · ${res.failedChunks}개 묶음은 요청 실패로 빠짐` : ''}`,
      sources: used,
      debug: { mode: 'summary', conditions: `${conditions} · 범위: ${scopeLabel}`, matched: docs.length, used, corpusSize: corpus.length, sentChars: res.sentChars, calls: res.calls, note: `${res.chunks}묶음 · 요청 ${res.calls}번` },
    };
  }

  // ---------- 일반 질문: 검색 → 근거로 답변 ----------
  const r: RetrievalResult = await retrieve(s, question, { today, corpus });
  if (!r.hits.length) {
    if (provider) return askGeneral(provider, question, history, { recordMiss: isRecordQuestion(question, today), conditions: r.conditions, corpusSize: corpus.length });
    return { text: NOT_FOUND, sources: [], debug: { mode: 'none', conditions: r.conditions, matched: 0, used: [], corpusSize: corpus.length, sentChars: 0, calls: 0 } };
  }
  if (!provider) return localList(r.hits.map((h) => h.doc), r.conditions, corpus.length);

  const picked: RecordDoc[] = [];
  let len = 0;
  for (const h of r.hits) {
    const t = formatDocForAI(h.doc, picked.length + 1);
    if (picked.length && len + t.length > ANSWER_BUDGET) break;
    picked.push(h.doc);
    len += t.length;
  }
  const sources = picked.map((d, i) => formatDocForAI(d, i + 1)).join('\n\n');
  const ctx = `오늘: ${today}\n검색 조건: ${r.conditions}\n조건에 맞는 기록 ${r.hits.length}건 중 ${picked.length}건(관련도 순)을 보냄.\n\n[기록]\n${sources}`;
  const text = clean(await provider.chat([...history.slice(-4), { role: 'user', content: question }], { label: `기록 ${picked.length}건`, text: ctx }, { system: ANSWER_SYSTEM, maxTokens: 1400 }));
  // 모델이 예전 방식대로 "못 찾았다"만 답하면, 기록 없이 일반 답변을 다시 만든다
  if (!text || text === NOT_FOUND || text.replace(/[\s.]/g, '') === NOT_FOUND.replace(/[\s.]/g, '')) {
    const g = await askGeneral(provider, question, history, { recordMiss: isRecordQuestion(question, today), conditions: r.conditions, corpusSize: corpus.length });
    return { ...g, debug: { ...g.debug, matched: r.hits.length, calls: 2, note: '검색된 기록이 질문과 맞지 않아 일반 답변' } };
  }
  const used = picked.map(toUsed);
  // [번호] 인용이 없으면 기록이 아닌 일반 지식으로 답한 것 → 기록 링크를 붙이지 않는다
  if (!/\[\d+\]/.test(text)) {
    return {
      text,
      footer: `기록 ${picked.length}건을 살펴봤지만 관련 내용이 없어 AI 일반 답변`,
      sources: [],
      debug: { mode: 'general', conditions: r.conditions, matched: r.hits.length, used, corpusSize: corpus.length, sentChars: ctx.length, calls: 1, note: '기록 인용 없음' },
    };
  }
  return {
    text,
    footer: r.hits.length > picked.length ? `관련 기록 ${r.hits.length}건 중 관련도 높은 ${picked.length}건 확인` : `관련 기록 ${picked.length}건 확인`,
    sources: used,
    debug: { mode: 'answer', conditions: r.conditions, matched: r.hits.length, used, corpusSize: corpus.length, sentChars: ctx.length, calls: 1 },
  };
}


/** AI 없이(기기 안에서만) 찾은 기록을 그대로 보여준다. 지어내는 문장 없음. */
function localList(docs: RecordDoc[], conditions: string, corpusSize: number, lead?: string): GroundedReply {
  const used = docs.map(toUsed);
  const top = docs.slice(0, 10);
  return {
    text: `${lead ?? `기록 ${docs.length}건을 찾았어.`}\n${top.map((d) => `• ${d.date ?? ''} / ${KIND_LABEL[d.kind]} / ${d.title}\n   ${d.text.replace(/\s+/g, ' ').slice(0, 90)}`).join('\n')}${docs.length > 10 ? `\n…외 ${docs.length - 10}건` : ''}`,
    sources: used.slice(0, 10),
    footer: `찾은 기록 ${docs.length}건`,
    debug: { mode: 'list', conditions, matched: docs.length, used, corpusSize, sentChars: 0, calls: 0, note: 'AI 미사용(기기 안 검색)' },
  };
}

export { parseQuery };
