import { addDays, addMonths, isoWeekday, parseISODate, startOfWeek, toISODate } from '../../utils/date';

// 자연어 질문을 검색 조건(날짜 범위 · 학년/반 · 기록 종류 · 완료 여부 · 키워드)으로 바꾼다.
// 예) "지난주 4학년 수업에서 뭐가 문제였어?" → 지난주 / 4학년 / 수업 / 키워드: 문제

export type DocKind =
  | 'lesson'
  | 'change'
  | 'meeting'
  | 'task'
  | 'event'
  | 'note'
  | 'dayNote'
  | 'page'
  | 'board'
  | 'progress'
  | 'summary'
  | 'inbox';

export const KIND_LABEL: Record<DocKind, string> = {
  lesson: '수업',
  change: '시간표 변경',
  meeting: '회의',
  task: '할 일',
  event: '일정',
  note: '메모',
  dayNote: '날짜 메모',
  page: '페이지',
  board: '자유보드',
  progress: '진도',
  summary: '하루 정리',
  inbox: 'AI Inbox',
};

export interface DateRange {
  from: string;
  to: string;
  label: string;
}

export interface ParsedQuery {
  raw: string;
  range?: DateRange;
  grades: number[];
  classes: string[]; // "4-2"
  kinds: DocKind[];
  status?: 'open' | 'done';
  irregular: boolean; // 정규 시간표와 다른 수업(변경 · 보결 · 이동)
  keywords: string[]; // 기록에 있어야 하는 말(일부만 맞아도 됨)
  soft: string[]; // "문제" "부족"처럼 기록에 그대로 없을 수 있는 말: 순위만 올리고 거르지 않는다
  phrases: string[]; // "따옴표" 안의 정확한 문구
  wantsSummary: boolean;
  wantsAll: boolean; // "전체", "모든"
}

const pad = (n: number) => String(n).padStart(2, '0');
const WD = '월화수목금토일';

function monthRange(y: number, m: number): DateRange {
  const from = `${y}-${pad(m)}-01`;
  const to = addDays(addMonths(from, 1), -1);
  return { from, to, label: `${y}년 ${m}월` };
}

/** 문장 속 날짜 표현 → 범위. 찾은 표현은 질문에서 지운다. */
function takeRange(q: string, today: string): { range?: DateRange; rest: string } {
  const t = parseISODate(today);
  const year = t.getFullYear();
  const pick = (m: number) => (m - 1 > t.getMonth() + 2 ? year - 1 : year); // 먼 미래 달은 작년으로 본다
  const rules: [RegExp, (m: RegExpMatchArray) => DateRange][] = [
    [/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/, (m) => {
      const d = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
      return { from: d, to: d, label: d };
    }],
    [/(\d{1,2})\s*월\s*(\d{1,2})\s*일/, (m) => {
      const d = `${pick(+m[1])}-${pad(+m[1])}-${pad(+m[2])}`;
      return { from: d, to: d, label: `${+m[1]}월 ${+m[2]}일` };
    }],
    [/(?<![\d.])(\d{1,2})\/(\d{1,2})(?![\d/])/, (m) => {
      const d = `${pick(+m[1])}-${pad(+m[1])}-${pad(+m[2])}`;
      return { from: d, to: d, label: `${+m[1]}/${+m[2]}` };
    }],
    [/(그저께|그제)/, () => ({ from: addDays(today, -2), to: addDays(today, -2), label: '그저께' })],
    [/어제/, () => ({ from: addDays(today, -1), to: addDays(today, -1), label: '어제' })],
    [/오늘/, () => ({ from: today, to: today, label: '오늘' })],
    [/내일/, () => ({ from: addDays(today, 1), to: addDays(today, 1), label: '내일' })],
    [/(지난|저번)\s*주\s*([월화수목금토일])요일/, (m) => {
      const d = addDays(startOfWeek(today), -7 + WD.indexOf(m[2]));
      return { from: d, to: d, label: `지난주 ${m[2]}요일` };
    }],
    [/(지난|저번)\s*주|전\s*주/, () => {
      const ws = addDays(startOfWeek(today), -7);
      return { from: ws, to: addDays(ws, 6), label: '지난주' };
    }],
    [/다음\s*주|담주/, () => {
      const ws = addDays(startOfWeek(today), 7);
      return { from: ws, to: addDays(ws, 6), label: '다음 주' };
    }],
    [/(이번|금)\s*주|이번주|주간/, () => {
      const ws = startOfWeek(today);
      return { from: ws, to: addDays(ws, 6), label: '이번 주' };
    }],
    [/(지난|저번)\s*달|전\s*달|지난달/, () => {
      const d = parseISODate(addMonths(today.slice(0, 8) + '01', -1));
      return monthRange(d.getFullYear(), d.getMonth() + 1);
    }],
    [/다음\s*달/, () => {
      const d = parseISODate(addMonths(today.slice(0, 8) + '01', 1));
      return monthRange(d.getFullYear(), d.getMonth() + 1);
    }],
    [/(이번|이)\s*달|이번달|이달/, () => monthRange(year, t.getMonth() + 1)],
    [/(\d{4})\s*년\s*(\d{1,2})\s*월/, (m) => monthRange(+m[1], +m[2])],
    [/(\d{1,2})\s*월/, (m) => monthRange(pick(+m[1]), +m[1])],
    [/최근\s*(\d{1,3})\s*일/, (m) => ({ from: addDays(today, -(+m[1] - 1)), to: today, label: `최근 ${m[1]}일` })],
    [/(\d{1,3})\s*일\s*전/, (m) => {
      const d = addDays(today, -+m[1]);
      return { from: d, to: d, label: `${m[1]}일 전` };
    }],
    [/([월화수목금토일])요일/, (m) => {
      const d = addDays(startOfWeek(today), WD.indexOf(m[1]));
      return { from: d, to: d, label: `이번 주 ${m[1]}요일` };
    }],
    [/최근|요즘/, () => ({ from: addDays(today, -13), to: today, label: '최근 2주' })],
  ];
  for (const [re, fn] of rules) {
    const m = q.match(re);
    if (m) return { range: fn(m), rest: q.replace(m[0], ' ') };
  }
  return { rest: q };
}

const KIND_WORDS: [RegExp, DocKind[]][] = [
  [/회의록|회의|부장회의|협의회|협의|교직원회의/, ['meeting']],
  [/수업|차시|레슨|lesson|단원/i, ['lesson']],
  [/할\s*일|투두|todo|태스크/i, ['task']],
  [/일정|행사|스케줄/, ['event']],
  [/자유\s*보드|보드|필기|손글씨/, ['board']],
  [/페이지|노트/, ['page']],
  [/진도/, ['progress', 'lesson']],
  [/하루\s*정리|하루\s*요약/, ['summary']],
  [/ai\s*inbox|인박스/i, ['inbox']],
  [/메모/, []], // 메모는 수업 메모 · 회의 메모 · 빠른 메모 모두라 종류를 좁히지 않는다
];

const IRREGULAR_RE = /(보결|바뀐|변경|교환|이동|휴강|정규\s*시간표|임시|대체)/;

// 질문 말투 · 조사 · 의미 없는 말
const STOP = new Set(
  [
    '찾아줘', '찾아', '알려줘', '알려', '보여줘', '보여', '정리해줘', '정리해', '정리', '요약해줘', '요약해', '요약',
    '뭐', '뭐가', '뭐야', '뭐였어', '무엇', '어떤', '어떻게', '언제', '어디', '왜', '좀', '그', '이', '저', '거', '것', '게',
    '내가', '제가', '나', '내', '우리', '적어둔', '적어', '써둔', '쓴', '적은', '기록한', '기록', '관련', '관련해서', '대해', '대해서', '해서',
    '있어', '있었어', '있나', '있는', '없어', '했어', '했던', '했지', '한', '하는', '할', '해야', '하기', '나온', '나왔던', '중', '전부', '다',
    '지난번', '저번', '예전', '그때', '내용', '것들', '거야', '줘', '주세요', '해줘', '해주세요', '부분', '쪽', '관해',
    '어때', '어땠어', '어땠지', '있어', '있었지', '있었나', '없었어', '들어간', '들어갔던', '들어갔어', '다르게', '다른', '달랐던', '바뀐', '바뀌었던',
    '정규시간표', '시간표', '정규', '임시로', '따로', '누가', '몇', '얼마나', '알고', '싶어', '궁금해', '확인', '확인해줘', '말해줘',
  ].map((w) => w.toLowerCase()),
);

// '이 · 가 · 도 · 만 · 나'처럼 명사 끝 글자와 헷갈리는 조사(놀이 · 아이 …)는 지우지 않는다
const JOSA = /(에서는|에서도|에서|에게서|에게|한테|께서|으로는|으로|이랑|랑|하고|와는|과는|은|는|을|를|의|까지|부터|처럼|보다|에는|에도|에)$/;
const ENDING = /(였어|였지|였나|였던|였니|이었어|했어|했니|했지|했던|하니|해줘|해요|이야|인가|인지|일까|었어|었지|어요|나요|니|냐)$/;

function normalizeWord(w: string): string {
  let x = w.replace(/[?!.,~"'“”‘’()[\]{}·…]/g, '').trim();
  if (!x) return '';
  for (let i = 0; i < 2; i++) {
    const before = x;
    x = x.replace(ENDING, '');
    if (x.length > 1) x = x.replace(JOSA, '') || x;
    if (x === before) break;
  }
  return x;
}

export function parseQuery(raw: string, today: string): ParsedQuery {
  let q = ` ${raw} `;
  const phrases = [...q.matchAll(/["“”']([^"“”']{2,})["“”']/g)].map((m) => m[1].trim());
  phrases.forEach((p) => (q = q.replace(p, ' ')));

  const { range, rest } = takeRange(q, today);
  q = rest;

  const grades: number[] = [];
  const classes: string[] = [];
  for (const m of q.matchAll(/(\d)\s*학년\s*(\d{1,2})\s*반/g)) classes.push(`${m[1]}-${+m[2]}`);
  q = q.replace(/(\d)\s*학년\s*(\d{1,2})\s*반/g, ' ');
  for (const m of q.matchAll(/(?<![\d.\/])(\d)\s*-\s*(\d{1,2})(?![\d])/g)) classes.push(`${m[1]}-${+m[2]}`);
  q = q.replace(/(?<![\d.\/])(\d)\s*-\s*(\d{1,2})(?![\d])/g, ' ');
  for (const m of q.matchAll(/(\d)\s*학년/g)) grades.push(+m[1]);
  q = q.replace(/(\d)\s*학년/g, ' ');

  const kinds = new Set<DocKind>();
  const lower = q.toLowerCase();
  for (const [re, ks] of KIND_WORDS) if (re.test(lower)) ks.forEach((k) => kinds.add(k));
  const irregular = IRREGULAR_RE.test(q);
  if (irregular) kinds.add('change');

  let status: ParsedQuery['status'];
  if (/(미완료|남은|남아|안\s*한|못\s*한|미룬|밀린|안\s*끝난|아직)/.test(q)) status = 'open';
  else if (/(완료한|끝낸|마친|다\s*한|해낸)/.test(q)) status = 'done';
  if (/(미룬|밀린|남은)\s*(업무|일)/.test(q) || /(업무)/.test(q)) kinds.add('task');

  const wantsSummary = /(요약|정리해|정리\s*해|돌아보|한눈에|총정리|리뷰|훑어)/.test(raw) && !/정리된|정리해\s*둔/.test(raw);
  const wantsAll = /(전체|모든|전부\s*다)/.test(raw);

  const keywords = q
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length >= 2 && !STOP.has(w.toLowerCase()))
    // 날짜 · 종류 · 상태를 나타내는 말은 이미 조건으로 바꿨으니 키워드에서 뺀다
    // ("보결" · "휴강" · "교환"은 꼭 들어 있어야 하는 말이라 키워드로 남긴다)
    .filter((w) => !/^(회의록|회의|수업|차시|할일|일정|메모|진도|업무|미완료|완료|변경|페이지|노트|보드|필기|행사|남은|미룬|밀린|문제)$/.test(w));

  // "문제", "이슈"처럼 질문 의도에 가까운 말은 키워드로 쓰되, 기록에 그대로 없을 수 있어 가중치만 준다
  const soft = raw.match(/(문제|이슈|부족|어려|힘들|잘\s*안|이동|옮긴)/g) ?? [];

  return {
    raw,
    range,
    grades,
    classes,
    kinds: [...kinds],
    status,
    irregular,
    keywords: [...new Set(keywords)],
    soft: [...new Set(soft.map((x) => x.replace(/\s+/g, '')))],
    phrases,
    wantsSummary,
    wantsAll,
  };
}

export function describeQuery(p: ParsedQuery): string {
  const parts: string[] = [];
  if (p.range) parts.push(`기간: ${p.range.label} (${p.range.from}${p.range.to !== p.range.from ? ` ~ ${p.range.to}` : ''})`);
  if (p.grades.length) parts.push(`학년: ${p.grades.join(', ')}학년`);
  if (p.classes.length) parts.push(`반: ${p.classes.join(', ')}`);
  if (p.kinds.length) parts.push(`종류: ${p.kinds.map((k) => KIND_LABEL[k]).join(', ')}`);
  if (p.status) parts.push(p.status === 'open' ? '미완료만' : '완료만');
  if (p.irregular) parts.push('정규 시간표와 다른 수업 포함');
  if (p.keywords.length) parts.push(`키워드: ${p.keywords.join(', ')}`);
  if (p.phrases.length) parts.push(`정확한 문구: ${p.phrases.map((x) => `"${x}"`).join(', ')}`);
  return parts.join(' · ') || '조건 없음(전체에서 찾기)';
}

export function weekdayKo(iso: string) {
  return '일월화수목금토'[parseISODate(iso).getDay()];
}

export { isoWeekday, toISODate };
