import { useEffect, useState, useSyncExternalStore } from 'react';
import { ClipboardCopy, RefreshCw, Save, Sparkles } from 'lucide-react';
import { Modal, confirmDialog, toast } from '../common/overlays';
import { useSettings } from '../../hooks/useData';
import { todayISO, formatKo } from '../../utils/date';
import { aiDailySummary, collectToday, countLabel, localDailySummary, todoCandidates, type DailyCollection, type TodoCandidate } from '../../services/ai/daily';
import { getAIProvider } from '../../services/ai/provider';
import { KIND_LABEL } from '../../services/ai/query';
import { db } from '../../services/localDb';
import * as repo from '../../services/repo';
import { addTask } from '../../services/tasks';
import type { Note } from '../../types';
import { react } from '../agent/agentStore';
import { useDevMode } from '../../services/devMode';
import { cx } from '../../utils/id';
import { RichText } from './RichText';

// ---------- 어디서든 열 수 있게 ----------
let open = false;
const ls = new Set<() => void>();
export function openDailySummary() {
  open = true;
  ls.forEach((l) => l());
}
function close() {
  open = false;
  ls.forEach((l) => l());
}
const useOpen = () =>
  useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => open,
  );

type Phase = 'scope' | 'working' | 'done' | 'error';

interface Result {
  text: string;
  total: number;
  analyzed: number;
  usedAI: boolean;
  usedKeys: string[];
  calls: number;
}

export function DailySummaryHost() {
  const isOpen = useOpen();
  if (!isOpen) return null;
  return <DailySummary />;
}

function DailySummary() {
  const s = useSettings();
  const dev = useDevMode();
  const date = todayISO();
  const [c, setC] = useState<DailyCollection | null>(null);
  const [phase, setPhase] = useState<Phase>('scope');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [aiReady, setAiReady] = useState(false);
  const [cands, setCands] = useState<TodoCandidate[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState(false);
  const provider = getAIProvider(s);

  useEffect(() => {
    collectToday(s, date).then(setC);
    provider.available().then(setAiReady);
  }, [s.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = async (r: Result, coll: DailyCollection) => {
    setResult(r);
    const all = await db.tasks.toArray();
    setCands(todoCandidates(coll, r.text, all));
    setPicked(new Set());
    setSaved(false);
    setPhase('done');
  };

  const generate = async (useAI: boolean) => {
    // 생성할 때마다 오늘 기록을 다시 모은다(그 사이 바뀐 내용 반영)
    const coll = await collectToday(s, date);
    setC(coll);
    if (!coll.docs.length) {
      await finish({ text: '', total: 0, analyzed: 0, usedAI: false, usedKeys: [], calls: 0 }, coll);
      return;
    }
    if (!useAI) {
      await finish({ text: localDailySummary(coll), total: coll.docs.length, analyzed: coll.docs.length, usedAI: false, usedKeys: coll.docs.map((d) => d.key), calls: 0 }, coll);
      return;
    }
    setPhase('working');
    setError('');
    react('thinking');
    try {
      const r = await aiDailySummary(provider, coll, setProgress);
      react('answer');
      await finish({ text: r.text, total: r.total, analyzed: r.analyzed, usedAI: true, usedKeys: r.usedKeys, calls: r.calls }, coll);
    } catch (e) {
      react('error');
      setError((e as Error).message);
      setPhase('error');
    } finally {
      setProgress('');
    }
  };

  const footer = result ? countLabel(result.total, result.analyzed) : '';
  const fullText = result ? `오늘의 업무 요약 (${formatKo(date)})\n\n${result.text}\n\n${footer}` : '';

  return (
    <Modal open onClose={close} title={<span>✨ 오늘 하루 정리 · {formatKo(date)}</span>} label="오늘 하루 정리" wide>
      <div className="daily">
        {/* 1) 수집 범위 */}
        <section className="daily__scope">
          <h3 className="section-title">오늘 확인할 기록 {c ? `${c.docs.length}개` : '…'}</h3>
          {!c ? (
            <p className="muted">오늘 기록을 모으는 중…</p>
          ) : c.groups.length === 0 ? (
            <p className="muted">오늘 날짜로 작성 · 수정된 기록이 없어요.</p>
          ) : (
            <ul className="list-reset daily__groups">
              {c.groups.map((g) => (
                <li key={g.id}>
                  <details>
                    <summary>
                      <b>{g.label}</b> <span className="chip">{g.docs.length}</span>
                    </summary>
                    <ul className="list-reset daily__items">
                      {g.docs.map((d) => (
                        <li key={d.key}>
                          <span className="muted">{KIND_LABEL[d.kind]}</span> {d.title}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
          {phase === 'scope' && c && (
            <div className="row row--wrap">
              <button className="btn btn--primary" disabled={!c.docs.length} onClick={() => generate(aiReady)}>
                <Sparkles size={16} /> {aiReady ? 'AI로 정리하기' : '기록으로 정리하기'}
              </button>
              {aiReady && (
                <button className="btn" disabled={!c.docs.length} onClick={() => generate(false)}>
                  AI 없이 기록만 정리
                </button>
              )}
              {!aiReady && <span className="muted">AI가 연결되지 않아 기록 문장만으로 정리해요(오프라인 가능).</span>}
            </div>
          )}
        </section>

        {phase === 'working' && <p className="daily__progress">{progress || '오늘 기록을 읽는 중…'}</p>}

        {phase === 'error' && (
          <div className="notice">
            <span style={{ flex: 1 }}>
              AI 정리를 만들지 못했어요: {error}
              <br />
              <span className="muted">원본 기록은 그대로예요. 기록 문장만으로 정리한 결과를 볼 수 있어요.</span>
            </span>
            <button className="btn btn--sm" onClick={() => generate(false)}>
              기록으로 정리 보기
            </button>
            <button className="btn btn--sm" onClick={() => generate(true)}>
              다시 시도
            </button>
          </div>
        )}

        {/* 2) 결과 */}
        {phase === 'done' && result && (
          <section className="daily__result">
            <h3 className="section-title">오늘의 업무 요약</h3>
            {result.total === 0 ? (
              <p>오늘 기록된 내용이 없어서 정리할 게 없어요.</p>
            ) : (
              <>
                <RichText text={result.text} />
                <p className="daily__count">
                  {footer}
                  {!result.usedAI && ' (AI 없이 기록 문장으로 정리)'}
                  {dev && result.usedAI && ` · AI 요청 ${result.calls}번`}
                </p>
              </>
            )}

            {cands.length > 0 && (
              <div className="daily__todos">
                <h4 className="title-font">남은 업무</h4>
                <p className="muted">이미 Todo에 있는 항목은 다시 넣지 않아요. 새로 넣을 것만 골라 주세요.</p>
                <ul className="list-reset">
                  {cands.map((t, i) => (
                    <li key={i}>
                      <label className={cx('check', t.existing && 'check--done')}>
                        <input
                          type="checkbox"
                          className="checkbox"
                          disabled={!!t.existing}
                          checked={picked.has(i)}
                          onChange={(e) => {
                            const n = new Set(picked);
                            if (e.target.checked) n.add(i);
                            else n.delete(i);
                            setPicked(n);
                          }}
                        />
                        <span className="check__text">
                          {t.text} <span className="muted">· {t.existing ? `이미 Todo에 있음${t.existing.completed ? '(완료)' : ''}` : t.from}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <button
                  className="btn btn--sm btn--primary"
                  disabled={!picked.size}
                  onClick={async () => {
                    for (const i of picked) await addTask({ title: cands[i].text, sourceType: 'assistant', sourceLabel: `하루 정리 ${date.slice(5).replace('-', '/')}` });
                    toast(`할 일 ${picked.size}개를 Todo에 넣었어요.`);
                    const all = await db.tasks.toArray();
                    setCands(cands.map((x) => ({ ...x, existing: x.existing ?? all.find((t) => t.title === x.text) })));
                    setPicked(new Set());
                  }}
                >
                  선택한 {picked.size}개 Todo에 추가
                </button>
              </div>
            )}

            <div className="row row--wrap daily__actions">
              <button
                className="btn btn--primary"
                disabled={!result.total || saved}
                onClick={async () => {
                  // 사용자가 누를 때만 저장한다. 기존 기록은 건드리지 않고 "하루 정리" 메모를 새로 만든다.
                  const already = await db.notes.where('date').equals(date).filter((n) => n.kind === 'summary').count();
                  if (already && !(await confirmDialog({ title: '오늘 정리가 이미 있어요', message: `오늘 저장한 하루 정리가 ${already}개 있어요. 기존 것은 그대로 두고 새로 하나 더 저장할까요?`, confirmLabel: '새로 저장' }))) return;
                  await repo.create<Note>('notes', { kind: 'summary', date, title: `하루 정리 ${date}`, text: fullText, attachments: [] });
                  setSaved(true);
                  toast('오늘 기록으로 저장했어요. (보관함 → 메모)');
                }}
              >
                <Save size={16} /> {saved ? '저장됨' : '오늘 기록으로 저장'}
              </button>
              <button
                className="btn"
                disabled={!result.total}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fullText);
                    toast('복사했어요.');
                  } catch {
                    toast('복사하지 못했어요.');
                  }
                }}
              >
                <ClipboardCopy size={16} /> 복사
              </button>
              <button className="btn" onClick={() => generate(aiReady)}>
                <RefreshCw size={16} /> 다시 생성
              </button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
