import { db } from './localDb';
import * as repo from './repo';
import { createInkDoc } from './attachments';
import type { PageBlock, PageGroup, PageTemplate, WorkspacePage } from '../types';
import { uuid } from '../utils/id';

export const TEMPLATES: { id: PageTemplate; label: string; desc: string }[] = [
  { id: 'board', label: '넓은 보드', desc: '손글씨 · 글상자 캔버스' },
  { id: 'blank', label: '빈 페이지', desc: '자유롭게 필기' },
  { id: 'lined', label: '줄노트', desc: '줄 있는 필기' },
  { id: 'grid', label: '모눈노트', desc: '모눈 필기' },
  { id: 'dot', label: '도트노트', desc: '점 격자 필기' },
  { id: 'meeting', label: '회의록', desc: '전달 · 결정 · 할 일' },
  { id: 'weekly', label: '주간계획', desc: '월~금 칸' },
  { id: 'monthly', label: '월간계획', desc: '목표 · 일정' },
  { id: 'checklist', label: '체크리스트', desc: '항목 체크' },
  { id: 'lesson', label: '수업노트', desc: '목표 · 활동 · 반성' },
];

export const INK_ONLY: PageTemplate[] = ['blank', 'lined', 'grid', 'dot', 'board'];

const text = (label: string): PageBlock => ({ id: uuid(), type: 'text', label, text: '' });
const list = (label: string): PageBlock => ({ id: uuid(), type: 'checklist', label, items: [] });

async function ink(bg: 'plain' | 'lined' | 'grid' | 'dot', w = 1200, h = 1600): Promise<PageBlock> {
  const d = await createInkDoc(bg, w, h);
  return { id: uuid(), type: 'ink', docId: d.id };
}

export async function blocksFor(t: PageTemplate): Promise<PageBlock[]> {
  switch (t) {
    case 'blank':
      return [await ink('plain')];
    case 'lined':
      return [await ink('lined')];
    case 'grid':
      return [await ink('grid')];
    case 'dot':
      return [await ink('dot')];
    case 'board':
      return [await ink('grid', 2000, 1400)];
    case 'meeting':
      return [text('전달사항'), text('결정사항'), list('해야 할 일'), text('메모')];
    case 'weekly':
      return [list('이번 주 할 일'), text('월'), text('화'), text('수'), text('목'), text('금'), text('메모')];
    case 'monthly':
      return [text('이번 달 목표'), text('주요 일정'), list('체크'), text('돌아보기')];
    case 'checklist':
      return [list('체크리스트')];
    case 'lesson':
      return [text('목표'), list('활동'), text('수업 흐름'), text('반성'), await ink('lined', 1200, 900)];
  }
}

export async function createPage(title: string, template: PageTemplate, groupId?: string): Promise<WorkspacePage> {
  const siblings = await db.pages.filter((p) => (p.groupId ?? '') === (groupId ?? '')).toArray();
  const order = siblings.reduce((m, p) => Math.max(m, p.order), 0) + 1;
  return repo.create<WorkspacePage>('pages', { title: title.trim() || '제목 없는 페이지', template, groupId, order, blocks: await blocksFor(template) });
}

export async function deletePage(p: WorkspacePage) {
  for (const b of p.blocks) if (b.type === 'ink') await repo.remove('inkDocs', b.docId);
  await repo.remove('pages', p.id);
}

export async function reorder(pages: WorkspacePage[], fromId: string, toId: string) {
  const ids = pages.map((p) => p.id);
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  for (const [i, id] of ids.entries()) {
    const p = pages.find((x) => x.id === id)!;
    if (p.order !== i + 1) await repo.update<WorkspacePage>('pages', id, { order: i + 1 });
  }
}

export const DEFAULT_GROUPS = ['영어', '업무', '회의', '연구', '학교행사', '아이디어'];

export async function seedGroups(year: number) {
  if ((await db.pageGroups.count()) > 0) return;
  const names = [...DEFAULT_GROUPS, `${year + 1} 계획`];
  await repo.bulkCreate<PageGroup>('pageGroups', names.map((name, i) => ({ name, order: i + 1 })));
}

export function pagePlainText(p: WorkspacePage): string {
  return p.blocks
    .map((b) => (b.type === 'text' || b.type === 'heading' ? `${'label' in b && b.label ? b.label + ': ' : ''}${b.text}` : b.type === 'checklist' ? b.items.map((i) => i.text).join(', ') : ''))
    .filter(Boolean)
    .join('\n');
}
