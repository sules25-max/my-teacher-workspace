import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, CheckSquare, PenLine, Trash2, Type } from 'lucide-react';
import { db } from '../services/localDb';
import * as repo from '../services/repo';
import { navigate, useRoute } from '../hooks/useRoute';
import { INK_ONLY, TEMPLATES, createPage, deletePage } from '../services/pages';
import { createInkDoc } from '../services/attachments';
import type { PageBlock, PageTemplate, WorkspacePage } from '../types';
import { cx, uuid } from '../utils/id';
import { Modal, confirmDialog, toast } from '../components/common/overlays';
import { AutoInput, AutoTextarea, Checklist } from '../components/common/fields';
import { EmptyState } from '../components/common/EmptyState';
import { InkCanvas } from '../components/canvas/InkCanvas';

/** 예전 Pages 주소(#/pages/…)는 자유보드로 넘긴다. 페이지 데이터는 그대로 자유보드에서 보인다 */
export function PagesPage() {
  const route = useRoute();
  const id = route.params[0];
  useEffect(() => {
    window.location.replace(`#/board${id ? `/${encodeURIComponent(id)}` : ''}`);
  }, [id]);
  return null;
}

export function NewPageModal({ open, onClose, fixedTemplate }: { open: boolean; onClose: () => void; fixedTemplate?: PageTemplate }) {
  const groups = useLiveQuery(() => db.pageGroups.orderBy('order').toArray(), []) ?? [];
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<PageTemplate>(fixedTemplate ?? 'board');
  const [groupId, setGroupId] = useState('');
  const create = async () => {
    const p = await createPage(title, fixedTemplate ?? template, groupId || undefined);
    setTitle('');
    onClose();
    navigate(`board/${p.id}`);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="새 자유보드"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn btn--primary" onClick={create}>
            만들기
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span className="field__label">이름</span>
          <input className="input" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예) 2학기 영어 아이디어" onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void create()} />
        </label>
        {!fixedTemplate && (
          <>
            <div className="field">
              <span className="field__label">템플릿</span>
              <div className="template-grid" role="radiogroup">
                {TEMPLATES.map((t) => (
                  <button key={t.id} role="radio" aria-checked={template === t.id} className={cx('template-card', `template-card--${t.id}`, template === t.id && 'is-active')} onClick={() => setTemplate(t.id)}>
                    <span className="template-card__thumb" aria-hidden="true" />
                    <span className="title-font">{t.label}</span>
                    <span className="muted">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span className="field__label">그룹</span>
              <select className="select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">미분류</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}

export function PageEditor({ id, canvasMode }: { id: string; canvasMode?: boolean }) {
  const page = useLiveQuery(async () => (await db.pages.get(id)) ?? null, [id]);
  const groups = useLiveQuery(() => db.pageGroups.orderBy('order').toArray(), []) ?? [];
  if (page === undefined) return null;
  if (page === null) return <EmptyState text="이 페이지를 찾을 수 없어." expression="worried" />;
  const inkOnly = INK_ONLY.includes(page.template);
  const save = (c: Partial<WorkspacePage>) => repo.update<WorkspacePage>('pages', page.id, c);
  const setBlocks = (blocks: PageBlock[]) => save({ blocks });
  const updateBlock = (b: PageBlock) => setBlocks(page.blocks.map((x) => (x.id === b.id ? b : x)));

  return (
    <article className={cx('page-doc', inkOnly && 'page-doc--ink', canvasMode && 'page-doc--canvas')}>
      <header className="page-doc__head">
        <AutoInput saveKey={`${page.id}:title`} value={page.title} onSave={(title) => save({ title })} className="page-doc__title" aria-label="페이지 이름" />
        <div className="row row--wrap page-doc__tools">
          <select className="select page-doc__group" value={page.groupId ?? ''} onChange={(e) => void save({ groupId: e.target.value || undefined })} aria-label="그룹">
            <option value="">미분류</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            aria-label="보관함으로"
            title="보관"
            onClick={async () => {
              await save({ archived: true });
              toast('보관함으로 옮겼어요.', { label: '되돌리기', run: () => void save({ archived: false }) });
              navigate('board');
            }}
          >
            <Archive size={18} />
          </button>
          <button
            className="icon-btn"
            aria-label="페이지 삭제"
            title="삭제"
            onClick={async () => {
              if (await confirmDialog({ title: '페이지 삭제', message: `"${page.title}"과 안의 필기를 모두 삭제할까요?\n지우지 않고 보관하려면 보관 버튼을 써 주세요.`, confirmLabel: '삭제', danger: true })) {
                await deletePage(page);
                navigate('board');
              }
            }}
          >
            <Trash2 size={18} />
          </button>
        </div>
      </header>

      <div className="page-doc__blocks">
        {page.blocks.map((b) => (
          <BlockView key={b.id} block={b} fill={inkOnly} onChange={updateBlock} onRemove={inkOnly ? undefined : () => setBlocks(page.blocks.filter((x) => x.id !== b.id))} />
        ))}
      </div>

      {!inkOnly && (
        <div className="row row--wrap page-doc__add">
          <span className="muted">블록 추가</span>
          <button className="btn btn--sm" onClick={() => setBlocks([...page.blocks, { id: uuid(), type: 'text', text: '' }])}>
            <Type size={16} /> 글
          </button>
          <button className="btn btn--sm" onClick={() => setBlocks([...page.blocks, { id: uuid(), type: 'checklist', items: [] }])}>
            <CheckSquare size={16} /> 체크리스트
          </button>
          <button
            className="btn btn--sm"
            onClick={async () => {
              const d = await createInkDoc('lined', 1200, 900);
              await setBlocks([...page.blocks, { id: uuid(), type: 'ink', docId: d.id }]);
            }}
          >
            <PenLine size={16} /> 필기 · 사진
          </button>
        </div>
      )}
    </article>
  );
}

function BlockView({ block, onChange, onRemove, fill }: { block: PageBlock; onChange: (b: PageBlock) => void; onRemove?: () => void; fill?: boolean }) {
  const remove = onRemove && (
    <button
      className="icon-btn block__remove"
      aria-label="블록 삭제"
      onClick={async () => {
        if (await confirmDialog({ title: '블록 삭제', message: '이 블록을 지울까요?', confirmLabel: '삭제', danger: true })) onRemove();
      }}
    >
      <Trash2 size={16} />
    </button>
  );
  switch (block.type) {
    case 'heading':
      return (
        <div className="block">
          <AutoInput saveKey={block.id} value={block.text} onSave={(text) => onChange({ ...block, text })} className="block__heading" />
          {remove}
        </div>
      );
    case 'text':
      return (
        <div className="block">
          {block.label && <h3 className="section-title">{block.label}</h3>}
          <AutoTextarea saveKey={block.id} value={block.text} onSave={(text) => onChange({ ...block, text })} lined rows={4} placeholder="여기에 적기…" aria-label={block.label ?? '글'} />
          {remove}
        </div>
      );
    case 'checklist':
      return (
        <div className="block">
          {block.label && <h3 className="section-title">{block.label}</h3>}
          <Checklist items={block.items} onChange={(items) => onChange({ ...block, items })} />
          {remove}
        </div>
      );
    case 'ink':
      return (
        <div className={cx('block block--ink', fill && 'block--fill')}>
          <InkCanvas docId={block.docId} mode={fill ? 'fill' : 'inline'} compactToolbar={!fill} />
          {remove}
        </div>
      );
  }
}
