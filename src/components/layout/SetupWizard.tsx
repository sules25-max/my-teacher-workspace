import { useState } from 'react';
import type { Settings } from '../../types';
import { db, requestPersistence } from '../../services/localDb';
import { seedGroups } from '../../services/pages';
import { defaultCurriculum } from '../../data/defaults';
import { ClassCounts, GradePicker } from '../../pages/SettingsPage';
import { AssistantAvatar } from '../assistant/AssistantAvatar';
import { AssistantBubble } from '../assistant/AssistantBubble';
import { PixelIcon } from '../common/Deco';
import { navigate } from '../../hooks/useRoute';
import { cx } from '../../utils/id';
import { PasteConnectCode } from '../common/DeviceConnect';

const STEPS = ['학년', '반', '차시', '동기화'] as const;

/** 처음 실행할 때 보여주는 4단계 설정. 가입이나 아이디는 요구하지 않는다. */
export function SetupWizard({ initial }: { initial: Settings }) {
  const [step, setStep] = useState(-1);
  const [draft, setDraft] = useState<Settings>({ ...initial });
  const patch = (c: Partial<Settings>) => setDraft((d) => ({ ...d, ...c }));

  const finish = async (connectNow: boolean) => {
    const curriculum = { ...draft.curriculum };
    for (const g of draft.grades) curriculum[g] = defaultCurriculum(draft.totalSessions);
    await db.settings.put({ ...draft, curriculum, setupDone: true, updatedAt: new Date().toISOString() });
    await seedGroups(draft.academicYear);
    void requestPersistence();
    navigate(connectNow ? 'settings?tab=sync' : 'settings?tab=timetable');
  };

  const expression = step < 0 ? 'happy' : step === 3 ? 'excited' : step === 2 ? 'thinking' : 'neutral';

  return (
    <div className="wizard">
      <div className="wizard__card card">
        <PixelIcon kind="plus" size={14} color="var(--blue)" className="wizard__deco wizard__deco--1" />
        <PixelIcon kind="star" size={18} color="var(--orange)" className="wizard__deco wizard__deco--2" />
        <PixelIcon kind="heart" size={14} color="var(--pink)" className="wizard__deco wizard__deco--3" />

        <div className="wizard__hero">
          <AssistantAvatar expression={expression} size={92} />
          <AssistantBubble tail="left">
            {step < 0 && '안녕! 나는 수첩 옆에 사는 AI 이나야. 몇 가지만 정하면 바로 쓸 수 있어.'}
            {step === 0 && '어떤 학년을 가르치나요? 여러 개 골라도 돼.'}
            {step === 1 && '반을 설정해 주세요.'}
            {step === 2 && '한 해 동안 몇 차시 수업하나요?'}
            {step === 3 && '다른 기기에서도 보려면 Google로 동기화할 수 있어.'}
          </AssistantBubble>
        </div>

        {step < 0 ? (
          <div className="wizard__body wizard__welcome">
            <p className="wizard__eyebrow title-font">Welcome to</p>
            <h1 className="wizard__title">
              My Teacher Workspace <span className="wizard__star">✦</span>
            </h1>
            <p className="muted">수업 · 진도 · 회의 · 손글씨를 한 권에. 모든 기록은 먼저 이 기기에 저장돼요.</p>
            <button className="btn btn--primary btn--title wizard__start" onClick={() => setStep(0)} data-autofocus>
              시작하기
            </button>
          </div>
        ) : (
          <div className="wizard__body">
            <ol className="wizard__steps list-reset" aria-label="설정 단계">
              {STEPS.map((label, i) => (
                <li key={label} className={cx(i === step && 'is-active', i < step && 'is-done')} aria-current={i === step ? 'step' : undefined}>
                  <span className="wizard__step-no">{i + 1}</span>
                  {label}
                </li>
              ))}
            </ol>

            {step === 0 && <GradePicker s={draft} onChange={patch} />}
            {step === 1 && <ClassCounts s={draft} onChange={patch} />}
            {step === 2 && (
              <div className="wizard__sessions">
                <div className="stepper">
                  <button className="icon-btn icon-btn--outline" aria-label="줄이기" onClick={() => patch({ totalSessions: Math.max(1, draft.totalSessions - 1) })}>
                    −
                  </button>
                  <input
                    className="input wizard__num title-font"
                    type="number"
                    value={draft.totalSessions}
                    onChange={(e) => patch({ totalSessions: Math.max(1, Number(e.target.value) || 34) })}
                    aria-label="총 수업 차시"
                  />
                  <button className="icon-btn icon-btn--outline" aria-label="늘리기" onClick={() => patch({ totalSessions: draft.totalSessions + 1 })}>
                    +
                  </button>
                </div>
                <p className="muted">기본 구성: Lesson 1~8 × 4차시 + 복습. 나중에 설정에서 바꿀 수 있어요.</p>
              </div>
            )}
            {step === 3 && (
              <div className="wizard__sync">
                <button className="btn btn--primary" onClick={() => finish(true)}>
                  지금 연결
                </button>
                <button className="btn" onClick={() => finish(false)}>
                  나중에
                </button>
                <p className="muted">‘나중에’를 누르면 시간표 설정으로 이동해요. 연결하지 않아도 모든 기능을 쓸 수 있어요.</p>
                <details className="wizard__paste">
                  <summary>다른 기기에서 이미 연결했어요 (연결 코드 붙여넣기)</summary>
                  <PasteConnectCode onDone={() => navigate('today')} />
                </details>
              </div>
            )}

            {step < 3 && (
              <div className="row row--between wizard__nav">
                <button className="btn btn--ghost" onClick={() => setStep(step - 1)}>
                  이전
                </button>
                <button className="btn btn--primary" onClick={() => setStep(step + 1)} disabled={step === 0 && !draft.grades.length}>
                  다음
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
