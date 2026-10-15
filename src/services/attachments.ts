import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './localDb';
import * as repo from './repo';
import type { Attachment, InkBackground, InkDoc } from '../types';
import { ensureAttachmentBlob } from './sync/syncEngine';

const MAX_PHOTO_EDGE = 2400;

/** 큰 사진은 기기 저장 공간과 동기화 시간을 아끼려고 긴 변 2400px JPEG로 줄인다. */
async function downscaleImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.86));
  } catch {
    return file;
  }
}

export async function addFiles(files: FileList | File[], owner: { type: string; id: string }): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const f of Array.from(files)) {
    const isImage = f.type.startsWith('image/');
    const blob = isImage ? await downscaleImage(f) : f;
    out.push(
      await repo.create<Attachment>('attachments', {
        kind: isImage ? 'photo' : 'file',
        name: f.name || (isImage ? '사진.jpg' : '파일'),
        mimeType: blob.type || f.type || 'application/octet-stream',
        size: blob.size,
        blob,
        ownerType: owner.type,
        ownerId: owner.id,
      }),
    );
  }
  return out;
}

export async function addLink(url: string, owner: { type: string; id: string }): Promise<Attachment> {
  const clean = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  let name = clean;
  try {
    name = new URL(clean).hostname;
  } catch {
    /* 그대로 */
  }
  return repo.create<Attachment>('attachments', {
    kind: 'link',
    name,
    url: clean,
    mimeType: 'text/uri-list',
    size: 0,
    ownerType: owner.type,
    ownerId: owner.id,
  });
}

export async function createInkDoc(background: InkBackground = 'plain', width = 1200, height = 1600): Promise<InkDoc> {
  return repo.create<InkDoc>('inkDocs', { width, height, background, strokes: [], images: [] });
}

export async function addInkAttachment(owner: { type: string; id: string }, name = '손글씨'): Promise<Attachment> {
  const doc = await createInkDoc('grid', 1200, 900);
  return repo.create<Attachment>('attachments', {
    kind: 'ink',
    name,
    mimeType: 'application/json',
    size: 0,
    inkDocId: doc.id,
    ownerType: owner.type,
    ownerId: owner.id,
  });
}

export async function removeAttachment(id: string) {
  const a = await db.attachments.get(id);
  if (a?.inkDocId) await repo.remove('inkDocs', a.inkDocId);
  await repo.remove('attachments', id);
}

export function useAttachments(ids: string[] | undefined): Attachment[] {
  const key = (ids ?? []).join(',');
  return (
    useLiveQuery(async () => {
      if (!ids?.length) return [];
      const rows = await db.attachments.bulkGet(ids);
      return rows.filter(Boolean) as Attachment[];
    }, [key]) ?? []
  );
}

/** 첨부 Blob을 화면에 표시할 object URL. 로컬에 없으면 Drive에서 내려받는다. */
export function useBlobUrl(att: Attachment | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let revoked = false;
    let made: string | undefined;
    if (!att) return;
    (async () => {
      const blob = att.blob ?? (await ensureAttachmentBlob(att).catch(() => undefined));
      if (!blob || revoked) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    })();
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [att?.id, att?.blob, att?.driveFileId]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
