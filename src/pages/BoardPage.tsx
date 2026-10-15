import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Plus } from 'lucide-react';
import { db } from '../services/localDb';
import { navigate, useRoute } from '../hooks/useRoute';
import { NewPageModal, PageEditor } from './PagesPage';
import { EmptyState } from '../components/common/EmptyState';
import { formatShort } from '../utils/date';
import { createPage } from '../services/pages';

/** GoodNotes처럼 넓은 캔버스에 자유롭게 필기하는 공간 */
export function BoardPage() {
  const route = useRoute();
  const id = route.params[0];
  const [creating, setCreating] = useState(false);
  const boards = useLiveQuery(() => db.pages.where('template').equals('board').filter((p) => !p.archived).reverse().sortBy('updatedAt'), []) ?? [];
  const previews = useLiveQuery(async () => {
    const m = new Map<string, string | undefined>();
    for (const b of boards) {
      const ink = b.blocks.find((x) => x.type === 'ink');
      if (ink?.type === 'ink') m.set(b.id, (await db.inkDocs.get(ink.docId))?.preview);
    }
    return m;
  }, [boards.map((b) => b.id + b.updatedAt).join()]);

  if (id) {
    return (
      <div className="board-open">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('board')}>
          <ArrowLeft size={16} /> 보드 목록
        </button>
        <PageEditor id={id} key={id} canvasMode />
      </div>
    );
  }

  return (
    <div className="boards">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Free Board</h1>
          <p className="page-head__sub">Apple Pencil로 마음껏 쓰는 노트</p>
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
            이름 정해서 만들기
          </button>
        </div>
      </div>
      {boards.length === 0 ? (
        <EmptyState text="아직 보드가 없어. ‘바로 쓰기’로 첫 장을 펼쳐 봐!" expression="excited" />
      ) : (
        <ul className="list-reset notebook-grid">
          {boards.map((b) => (
            <li key={b.id}>
              <a className="notebook" href={`#/board/${b.id}`}>
                <span className="notebook__cover">{previews?.get(b.id) ? <img src={previews.get(b.id)} alt="" /> : <span className="notebook__blank" />}</span>
                <span className="notebook__title title-font">{b.title}</span>
                <span className="muted notebook__date">{formatShort(b.updatedAt.slice(0, 10))}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <NewPageModal open={creating} onClose={() => setCreating(false)} fixedTemplate="board" />
    </div>
  );
}
