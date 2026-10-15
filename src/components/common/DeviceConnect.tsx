import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Copy, Eye, EyeOff, Share2 } from 'lucide-react';
import { buildConnectLink, decodeConnectCode, encodeConnectCode, type ConnectInfo } from '../../services/sync/connectLink';
import { connectThisDevice } from '../../services/sync/connect';
import { confirmDialog, toast } from './overlays';

/** 연결된 기기에서: 다른 기기를 연결할 QR · 링크 · 코드를 보여준다 */
export function ShareConnection({ info }: { info: ConnectInfo }) {
  const [shown, setShown] = useState(false);
  const link = useMemo(() => buildConnectLink(info), [info]);
  const code = useMemo(() => encodeConnectCode(info), [info]);
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [link]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what}를 복사했어요. 다른 기기에서 붙여 넣어 주세요.`);
    } catch {
      toast('복사하지 못했어요. 길게 눌러 직접 복사해 주세요.');
    }
  };

  return (
    <div className="device-share card card--blue">
      <div className="card__body stack">
        <h3 className="section-title">다른 기기 연결</h3>
        <p className="muted">
          iPad · iPhone · 다른 컴퓨터에서 아래 QR을 찍거나 링크를 열면 입력 없이 바로 이 수첩에 연결돼요. 홈 화면에 추가한 앱이라면 ‘연결 코드’를 복사해 앱의 설정 → Google 동기화에 붙여 넣어 주세요.
        </p>
        {shown ? (
          <div className="device-share__qr" role="img" aria-label="기기 연결 QR 코드" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <button className="device-share__hidden" onClick={() => setShown(true)}>
            <Eye size={18} /> QR 보기 (주변에 다른 사람이 없을 때)
          </button>
        )}
        <div className="row row--wrap">
          <button className="btn btn--sm btn--primary" onClick={() => copy(link, '연결 링크')}>
            <Copy size={16} /> 링크 복사
          </button>
          <button className="btn btn--sm" onClick={() => copy(code, '연결 코드')}>
            <Copy size={16} /> 연결 코드 복사
          </button>
          {typeof navigator.share === 'function' && (
            <button className="btn btn--sm" onClick={() => navigator.share({ title: 'My Teacher Workspace 기기 연결', url: link }).catch(() => undefined)}>
              <Share2 size={16} /> 내 기기로 보내기 (AirDrop)
            </button>
          )}
          {shown && (
            <button className="btn btn--sm btn--ghost" onClick={() => setShown(false)}>
              <EyeOff size={16} /> 숨기기
            </button>
          )}
        </div>
        <p className="muted device-share__warn">⚠ 이 링크·QR·코드가 있으면 누구나 내 수첩에 접근할 수 있어요. 내 기기끼리만 주고받고, 유출됐다면 Apps Script에서 rotateToken을 실행해 바꿔 주세요.</p>
      </div>
    </div>
  );
}

/** 새 기기에서: 받은 연결 링크/코드를 붙여 넣어 연결한다 (홈 화면 앱처럼 링크가 바로 안 열리는 경우) */
export function PasteConnectCode({ onDone }: { onDone?: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const info = decodeConnectCode(value);
  return (
    <form
      className="paste-code"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!info) return;
        const ok = await confirmDialog({
          title: '이 기기 연결',
          message: `${new URL(info.endpoint).hostname} 에 연결하고 클라우드 수첩을 불러올까요?\n이 기기의 설정은 클라우드 설정으로 바뀌고, 이 기기에 적은 기록은 함께 합쳐져요.`,
          confirmLabel: '연결하기',
        });
        if (!ok) return;
        setBusy(true);
        try {
          await connectThisDevice(info);
          toast('연결했어요. 수첩을 불러오는 중이에요.');
          setValue('');
          onDone?.();
        } catch (err) {
          toast((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span className="field__label">연결 코드 / 링크 붙여넣기</span>
        <div className="row">
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="MTW1.… 또는 연결 링크" autoComplete="off" autoCapitalize="off" spellCheck={false} />
          {typeof navigator.clipboard?.readText === 'function' && (
            <button
              type="button"
              className="btn btn--sm"
              onClick={async () => {
                try {
                  setValue(await navigator.clipboard.readText());
                } catch {
                  toast('입력칸을 길게 눌러 붙여 넣어 주세요.');
                }
              }}
            >
              붙여넣기
            </button>
          )}
        </div>
      </label>
      {value && !info && <p className="chip chip--warn">올바른 연결 코드가 아니에요.</p>}
      <button className="btn btn--primary" disabled={!info || busy}>
        {busy ? '연결 중…' : '이 기기 연결'}
      </button>
    </form>
  );
}
