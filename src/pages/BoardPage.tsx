import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, FolderPlus, LayoutTemplate, Plus, Trash2, Type } from 'lucide-react';
import { db } from '../services/localDb';
import * as repo from '../services/repo';
import { navigate, useRoute } from '../hooks/useRoute';
import { NewPageModal, PageEditor } from './PagesPage';
import { EmptyState } from '../components/common/EmptyState';
import { confirmDialog, promptDialog } from '../components/common/overlays';
import { formatShort } from '../utils/date';
import { cx } from '../utils/id';
import { TEMPLATES, createPage, pagePlainText, reorder } from '../services/pages';
import type { PageGroup, WorkspacePage } from '../types';

/** 자유보드: 손글씨 보드와 템플릿 노트(예전 Pages)를 한곳에서 관리한다 */
export function BoardPage() {
  const route = useRoute();
  const id = route.params[0];
  const [creating, setCreating] = useState(false);
  const groups = useLiveQuery(() => db.pageGroups.orderBy('order').toArray(), []) ?? [];
  const pages = useLiveQuery(() => db.pages.orderBy('order').filter((p) => !p.archived).toArray(), []) ?? [];
  const covers = useLiveQuery(async () => {
    const m = new Map<string, string | undefined>();
    for (const p of pages) {
      const ink = p.blocks.find((x) => x.type === 'ink');
      if (ink?.type === 'ink') m.set(p.id, (await db.inkDocs.get(ink.docId))?.preview);
    }
    return m;
  }, [pages.map((p) => p.id + p.updatedAt).join()]);
  const [dragId, setDragId] = useState<string | null>(null);

  if (id) {
    return (
      <div className="board-open">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('board')}>
          <ArrowLeft size={16} /> 자유보드 목록
        </button>
        <PageEditor id={id} key={id} canvasMode />
      </div>
    );
  }

  // 미분류(바로 쓰기 보드가 들어가는 곳) → 내용 있는 그룹 → 빈 그룹(한 줄로 작게)
  const byGroup = groups.map((g) => ({ group: g as PageGroup | undefined, items: pages.filter((p) => p.groupId === g.id) }));
  const sections = [
    { group: undefined, items: pages.filter((p) => !p.groupId || !groups.some((g) => g.id === p.groupId)) },
    ...byGroup.filter((x) => x.items.length),
    ...byGroup.filter((x) => !x.items.length),
  ];

  const drop = async (target: WorkspacePage, items: WorkspacePage[]) => {
    if (dragId && dragId !== target.id) {
      const dragged = pages.find((x) => x.id === dragId);
      if (dragged && (dragged.groupId ?? '') !== (target.groupId ?? '')) await repo.update<WorkspacePage>('pages', dragId, { groupId: target.groupId });
      await reorder([...items.filter((x) => x.id !== dragId), ...(dragged ? [dragged] : [])].sort((a, b) => a.order - b.order), dragId, target.id);
    }
    setDragId(null);
  };

  return (
    <div className="boards">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Free Board</h1>
          <p className="page-head__sub">손글씨 · 키보드 글 · 템플릿 노트를 한곳에</p>
        </div>
        <div className="page-head__actions">
          <button
            className="btn btn--primary"
            onClick={async () => {
              const p = await createPage(`보드 ${formatShort(new Date().toISOString().slice(0, 10))}`, 'board');
              navigate(`board/${p.id}`);
            }}
          >
            <Plus size={18} /> 바로 쓰기
          </button>
          <button className="btn" onClick={() => setCreating(true)}>
            <LayoutTemplate size={16} /> 템플릿으로 만들기
          </button>
          <button
            className="btn btn--ghost"
            onClick={async () => {
              const name = await promptDialog({ title: '새 그룹', placeholder: '예) 2027 계획', confirmLabel: '만들기' });
              if (name?.trim()) await repo.create<PageGroup>('pageGroups', { name: name.trim(), order: groups.length + 1 });
            }}
          >
            <FolderPlus size={16} /> 그룹 추가
          </button>
        </div>
      </div>

      {pages.length === 0 ? (
        <EmptyState text="아직 보드가 없어. ‘바로 쓰기’로 첫 장을 펼쳐 봐!" expression="excited" />
      ) : (
        sections.map(({ group, items }) =>
          !items.length && !group ? null : (
            <section key={group?.id ?? 'none'} className={cx('board-group', !items.length && 'board-group--empty')}>
              <div className="page-group__head">
                <h2 className="section-title board-group__title">{group?.name ?? '미분류'}</h2>
                <span className="chip">{items.length ? items.length : '비어 있음'}</span>
                {group && (
                  <span className="page-group__tools">
                    <button
                      className="icon-btn"
                      aria-label={`${group.name} 이름 바꾸기`}
                      onClick={async () => {
                        const name = await promptDialog({ title: '그룹 이름', defaultValue: group.name, confirmLabel: '저장' });
                        if (name?.trim()) await repo.update<PageGroup>('pageGroups', group.id, { name: name.trim() });
                      }}
                    >
                      <Type size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`${group.name} 그룹 삭제`}
                      onClick={async () => {
                        if (!(await confirmDialog({ title: '그룹 삭제', message: `"${group.name}" 그룹을 지울까요? 안의 보드는 미분류로 옮겨져요.`, confirmLabel: '삭제', danger: true }))) return;
                        for (const p of items) await repo.update<WorkspacePage>('pages', p.id, { groupId: undefined });
                        await repo.remove('pageGroups', group.id);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </span>
                )}
              </div>
              {items.length === 0 ? null : (
                <ul className="list-reset notebook-grid">
                  {items.map((p, i) => {
                    const tmpl = TEMPLATES.find((t) => t.id === p.template);
                    const cover = covers?.get(p.id);
                    const text = cover ? '' : pagePlainText(p).slice(0, 160);
                    return (
                      <li
                        key={p.id}
                        className={cx('board-card', dragId === p.id && 'is-dragging')}
                        draggable
                        onDragStart={() => setDragId(p.id)}
                        onDragEnd={() => setDragId(null)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => void drop(p, items)}
                      >
                        <a className="notebook" href={`#/board/${p.id}`} draggable={false}>
                          <span className="notebook__cover">
                            {cover ? <img src={cover} alt="" draggable={false} /> : text ? <span className="notebook__text">{text}</span> : <span className="notebook__blank" />}
                          </span>
                          <span className="notebook__title title-font">{p.title}</span>
                          <span className="muted notebook__date">
                            {tmpl?.label ?? '보드'} · {formatShort(p.updatedAt.slice(0, 10))}
                          </span>
                        </a>
                        <span className="board-card__move">
                          <button className="icon-btn" disabled={i === 0} onClick={() => reorder(items, p.id, items[i - 1].id)} aria-label={`${p.title} 앞으로`}>
                            <ArrowLeft size={16} />
                          </button>
                          <button className="icon-btn" disabled={i === items.length - 1} onClick={() => reorder(items, p.id, items[i + 1].id)} aria-label={`${p.title} 뒤로`}>
                            <ArrowRight size={16} />
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ),
        )
      )}
      <NewPageModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
