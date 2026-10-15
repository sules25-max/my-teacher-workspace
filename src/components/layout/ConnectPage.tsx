import { useEffect, useState } from 'react';
import { decodeConnectCode, type ConnectInfo } from '../../services/sync/connectLink';
import { connectThisDevice } from '../../services/sync/connect';
import { AssistantAvatar } from '../assistant/AssistantAvatar';
import { AssistantBubble } from '../assistant/AssistantBubble';
import { navigate } from '../../hooks/useRoute';

/**
 * #/connect/<연결 코드> 로 열리는 화면. 설정 마법사보다 먼저 보여서
 * 새 기기도 링크 하나(또는 QR)로 기존 수첩을 그대로 불러온다.
 */
export function ConnectPage({ code }: { code: string }) {
  const [info] = useState<ConnectInfo | null>(() => decodeConnectCode(code));
  const [state, setState] = useState<'ask' | 'working' | 'done' | 'error'>('ask');
  const [error, setError] = useState('');

  // 토큰이 담긴 주소가 방문 기록에 남지 않도록 바로 지운다
  useEffect(() => {
    history.replaceState(null, '', `${location.pathname}#/connect`);
  }, []);

  const host = info ? new URL(info.endpoint).hostname : '';

  return (
    <div className="wizard">
      <div className="wizard__card card">
        <div className="wizard__hero">
          <AssistantAvatar expression={state === 'done' ? 'excited' : state === 'error' ? 'worried' : state === 'working' ? 'thinking' : 'happy'} size={92} />
          <AssistantBubble tail="left">
            {!info && '연결 코드가 올바르지 않아. 처음 연결한 기기의 설정 → Google 동기화에서 링크를 다시 만들어 줘.'}
            {info && state === 'ask' && '이 기기를 내 Google 수첩에 연결할까? 다른 기기에서 쓰던 기록을 그대로 불러올게.'}
            {state === 'working' && '수첩을 불러오는 중이야…'}
            {state === 'done' && '연결 완료! 이제 이 기기에서도 같은 수첩이야.'}
            {state === 'error' && `연결하지 못했어. ${error}`}
          </AssistantBubble>
        </div>
        <div className="wizard__body">
          <h1 className="wizard__title">기기 연결</h1>
          {info && <p className="muted">연결 대상: {host} (Google Apps Script)</p>}
          <div className="wizard__sync">
            {info && (state === 'ask' || state === 'error') && (
              <button
                className="btn btn--primary btn--title"
                onClick={async () => {
                  setState('working');
                  try {
                    await connectThisDevice(info);
                    setState('done');
                  } catch (e) {
                    setError((e as Error).message);
                    setState('error');
                  }
                }}
              >
                이 기기 연결하기
              </button>
            )}
            {state === 'done' && (
              <button className="btn btn--primary btn--title" onClick={() => navigate('today')}>
                수첩 열기
              </button>
            )}
            {state !== 'working' && state !== 'done' && (
              <button className="btn" onClick={() => navigate('today')}>
                취소
              </button>
            )}
          </div>
          <p className="muted">연결 정보는 이 기기에만 저장돼요. 링크나 QR은 다른 사람에게 보내지 마세요.</p>
        </div>
      </div>
    </div>
  );
}
