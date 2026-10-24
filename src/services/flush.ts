// 입력 중(디바운스 대기 중)인 내용을 "지금 바로" 저장시키는 공통 장치.
// 새 버전 적용 · 앱이 백그라운드로 갈 때 · 페이지를 닫을 때 마지막 입력이 사라지지 않게 한다.

type Flusher = () => void | Promise<void>;

const flushers = new Set<Flusher>();

export function onFlushRequest(fn: Flusher): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

/** 등록된 모든 저장 대기 작업을 즉시 실행하고 끝날 때까지 기다린다. */
export async function flushAllPending(): Promise<void> {
  const tasks = [...flushers].map((f) => {
    try {
      return Promise.resolve(f());
    } catch {
      return Promise.resolve();
    }
  });
  await Promise.allSettled(tasks);
}

let installed = false;
export function installFlushOnHide() {
  if (installed) return;
  installed = true;
  const run = () => void flushAllPending();
  window.addEventListener('pagehide', run);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') run();
  });
}
