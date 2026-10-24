import { db } from '../../services/localDb';
import * as repo from '../../services/repo';
import { setSlotOverride, periodIndex } from '../../services/planner';
import type { LessonRecord, Settings, SlotOverride } from '../../types';
import { parseClassKey } from '../../utils/id';
import { confirmDialog, toast } from '../common/overlays';

/**
 * 특정 날짜 칸의 반을 이번 주만 바꾼다.
 * next: 반(classKey) / null: 휴강·수업 없음
 * 이미 적어 둔 수업 기록이 있으면 새 반으로 옮기거나(휴강이면) 지울지 확인한다.
 */
export async function changeSlotClass(
  s: Settings,
  date: string,
  periodId: string,
  next: string | null,
  regular: string | undefined,
  note?: string,
  kind?: SlotOverride['kind'],
): Promise<boolean> {
  const rec = await db.lessons.where('[date+periodId]').equals([date, periodId]).first();
  if (rec && rec.classKey !== next) {
    if (rec.completed) {
      toast(`${rec.classKey} 수업이 완료 표시되어 있어요. 수업 카드에서 완료를 먼저 취소해 주세요.`);
      return false;
    }
    const hasContent = !!(rec.lesson || rec.memo?.trim() || rec.attachments.length || rec.objective);
    if (next === null) {
      if (hasContent) {
        const ok = await confirmDialog({
          title: '이 칸 비우기',
          message: `${rec.classKey}의 ${rec.lesson || '수업'} ${rec.session ? rec.session + '차시 ' : ''}계획이 적혀 있어요.\n이번 주 이 칸을 비우면 이 계획은 지워져요.`,
          confirmLabel: '비우기',
          danger: true,
        });
        if (!ok) return false;
      }
      await repo.remove('lessons', rec.id);
    } else {
      if (hasContent) {
        const ok = await confirmDialog({
          title: '반 바꾸기',
          message: `이 칸에 ${rec.classKey}의 ${rec.lesson || '수업'} ${rec.session ? rec.session + '차시 ' : ''}계획이 있어요.\n계획은 그대로 두고 반만 ${next}(으)로 바꿀까요?`,
          confirmLabel: '바꾸기',
        });
        if (!ok) return false;
      }
      const { grade, classNumber } = parseClassKey(next);
      await repo.update<LessonRecord>('lessons', rec.id, { classKey: next, grade, classNumber, period: periodIndex(s, periodId) });
    }
  }
  // 정기 시간표에 반이 없는 칸을 비우는 것은 "변경 없음"
  await setSlotOverride(s, date, periodId, next === null && !regular ? undefined : next, note, kind);
  return true;
}
