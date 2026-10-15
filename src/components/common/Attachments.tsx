import { useRef, useState } from 'react';
import { Camera, File as FileIcon, ImageIcon, Link2, PenLine, X } from 'lucide-react';
import { addFiles, addInkAttachment, addLink, formatSize, removeAttachment, useAttachments, useBlobUrl } from '../../services/attachments';
import type { Attachment } from '../../types';
import { confirmDialog, Modal, promptDialog } from './overlays';
import { InkCanvas } from '../canvas/InkCanvas';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/localDb';

interface Props {
  ids: string[];
  owner: { type: string; id: string };
  onChange: (ids: string[]) => Promise<void> | void;
  /** 손글씨 버튼 표시 여부 */
  ink?: boolean;
}

/** 📷 사진 · 📎 파일 · ✏ 손글씨 · 🔗 링크 첨부 영역 */
export function AttachmentBar({ ids, owner, onChange, ink = true }: Props) {
  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const items = useAttachments(ids);
  const [openInk, setOpenInk] = useState<Attachment | null>(null);
  const [viewer, setViewer] = useState<Attachment | null>(null);

  const add = async (atts: Attachment[]) => {
    await onChange([...ids, ...atts.map((a) => a.id)]);
    return atts;
  };

  return (
    <div className="attach">
      <div className="attach__buttons">
        <button className="btn btn--sm" onClick={() => cameraRef.current?.click()}>
          <Camera size={16} /> 촬영
        </button>
        <button className="btn btn--sm" onClick={() => photoRef.current?.click()}>
          <ImageIcon size={16} /> 사진
        </button>
        <button className="btn btn--sm" onClick={() => fileRef.current?.click()}>
          <FileIcon size={16} /> 파일
        </button>
        {ink && (
          <button
            className="btn btn--sm"
            onClick={async () => {
              const [a] = await add([await addInkAttachment(owner)]);
              setOpenInk(a);
            }}
          >
            <PenLine size={16} /> 손글씨
          </button>
        )}
        <button
          className="btn btn--sm"
          onClick={async () => {
            const url = await promptDialog({ title: '링크 추가', placeholder: 'https://', confirmLabel: '추가' });
            if (url?.trim()) await add([await addLink(url.trim(), owner)]);
          }}
        >
          <Link2 size={16} /> 링크
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => e.target.files && (await add(await addFiles(e.target.files, owner)), (e.target.value = ''))} />
        <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={async (e) => e.target.files && (await add(await addFiles(e.target.files, owner)), (e.target.value = ''))} />
        <input ref={fileRef} type="file" multiple hidden onChange={async (e) => e.target.files && (await add(await addFiles(e.target.files, owner)), (e.target.value = ''))} />
      </div>
      {items.length > 0 && (
        <ul className="attach__list list-reset">
          {items.map((a) => (
            <AttachmentTile
              key={a.id}
              att={a}
              onOpen={() => (a.kind === 'ink' ? setOpenInk(a) : a.kind === 'link' ? window.open(a.url, '_blank', 'noopener') : setViewer(a))}
              onRemove={async () => {
                if (await confirmDialog({ title: '첨부 삭제', message: `"${a.name}"을(를) 삭제할까요?`, confirmLabel: '삭제', danger: true })) {
                  await onChange(ids.filter((x) => x !== a.id));
                  await removeAttachment(a.id);
                }
              }}
            />
          ))}
        </ul>
      )}
      <Modal open={!!openInk} onClose={() => setOpenInk(null)} title="✏ 손글씨" wide label="손글씨 편집">
        {openInk?.inkDocId && (
          <div className="ink-modal-body">
            <InkCanvas docId={openInk.inkDocId} mode="fill" />
          </div>
        )}
      </Modal>
      <Modal open={!!viewer} onClose={() => setViewer(null)} title={viewer?.name ?? ''} wide label="첨부 보기">
        {viewer && <AttachmentViewer att={viewer} />}
      </Modal>
    </div>
  );
}

function AttachmentTile({ att, onOpen, onRemove }: { att: Attachment; onOpen: () => void; onRemove: () => void }) {
  const url = useBlobUrl(att.kind === 'photo' ? att : undefined);
  const inkPreview = useLiveQuery(async () => (att.inkDocId ? (await db.inkDocs.get(att.inkDocId))?.preview : undefined), [att.inkDocId]);
  return (
    <li className="attach__tile">
      <button className="attach__open" onClick={onOpen} aria-label={`${att.name} 열기`}>
        {att.kind === 'photo' && url ? (
          <img src={url} alt="" />
        ) : att.kind === 'ink' && inkPreview ? (
          <img src={inkPreview} alt="" />
        ) : (
          <span className="attach__icon">{att.kind === 'link' ? <Link2 /> : att.kind === 'ink' ? <PenLine /> : <FileIcon />}</span>
        )}
        <span className="attach__name">{att.name}</span>
        {att.size > 0 && <span className="attach__meta">{formatSize(att.size)}</span>}
      </button>
      <button className="attach__remove" onClick={onRemove} aria-label={`${att.name} 삭제`}>
        <X size={14} />
      </button>
    </li>
  );
}

function AttachmentViewer({ att }: { att: Attachment }) {
  const url = useBlobUrl(att);
  if (!url) return <p className="modal__body muted">불러오는 중… (오프라인이면 원본을 받을 수 없어요)</p>;
  if (att.kind === 'photo') return <img className="attach__full" src={url} alt={att.name} />;
  if (att.mimeType === 'application/pdf') return <iframe className="attach__frame" src={url} title={att.name} />;
  return (
    <div className="modal__body">
      <a className="btn" href={url} download={att.name}>
        파일 열기 / 저장 ({formatSize(att.size)})
      </a>
    </div>
  );
}
