// iPad + 무선 키보드: 입력칸을 누르거나 타자를 칠 때 iOS가 화면을 마음대로 굴려
// 입력칸이 맨 위로 올라가 버리는 문제를 막는다.
// 입력칸이 원래 자리에서도 잘 보였다면 iOS가 바꾼 스크롤을 되돌리고,
// (화상 키보드에 가려지는 등) 정말 안 보일 때만 iOS의 스크롤을 그대로 둔다.

const EDITABLE = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=range]), textarea, select, [contenteditable="true"]';

export function isIOS() {
  return /iP(ad|hone|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function scrollersOf(el: Element): Element[] {
  const out: Element[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) out.push(p);
  }
  out.push(document.scrollingElement ?? document.documentElement);
  return out;
}

/** 입력칸이 지금 화면(가상 키보드 · 위쪽 고정 바 제외)에 다 보이는지 */
function fieldVisible(el: HTMLElement): boolean {
  const vv = window.visualViewport;
  const viewTop = vv?.offsetTop ?? 0;
  const viewBottom = viewTop + (vv?.height ?? window.innerHeight);
  let top = viewTop;
  // 본문 입력칸이면 위에 붙어 있는 상단 바 아래부터를 보이는 영역으로 본다
  const bar = document.querySelector('.topbar');
  if (bar && !el.closest('.drawer, .modal, .ai-panel')) top = Math.max(top, bar.getBoundingClientRect().bottom);
  const r = el.getBoundingClientRect();
  const room = viewBottom - 8 - top;
  if (r.height > room * 0.7) return false; // 아주 긴 입력칸은 커서 위치를 알 수 없으니 iOS에 맡긴다
  return r.top >= top && r.bottom <= viewBottom - 8;
}

export function installStableFocus(force = false) {
  if (!force && !isIOS()) return () => {};
  let active: HTMLElement | null = null;
  let userUntil = 0;
  const pos = new Map<Element, number>();

  const remember = (el: Element) => {
    for (const sc of scrollersOf(el)) pos.set(sc, sc.scrollTop);
  };
  const userScroll = () => {
    userUntil = performance.now() + 700;
  };
  const onKey = (e: KeyboardEvent) => {
    // 입력칸 밖에서 쓰는 화면 이동 키만 "사용자가 직접 스크롤"로 본다
    if (!(e.target as Element).closest?.(EDITABLE) && ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) userScroll();
  };
  const onPointerDown = (e: Event) => {
    const t = (e.target as Element).closest?.(EDITABLE);
    if (t) remember(t); // 누르는 순간의 위치(iOS가 굴리기 전)
  };
  const onFocusIn = (e: FocusEvent) => {
    const t = (e.target as Element).closest?.(EDITABLE) as HTMLElement | null;
    active = t;
    if (t && !pos.size) remember(t);
  };
  const onFocusOut = () => {
    active = null;
    pos.clear();
  };
  const onScroll = (e: Event) => {
    const sc = e.target === document ? (document.scrollingElement ?? document.documentElement) : (e.target as Element);
    if (!active || document.activeElement !== active) return;
    if (performance.now() < userUntil || !pos.has(sc)) {
      pos.set(sc, sc.scrollTop);
      return;
    }
    const prev = pos.get(sc)!;
    const cur = sc.scrollTop;
    if (Math.abs(cur - prev) < 2) return;
    sc.scrollTop = prev; // 원래 자리에서 잘 보이면 그대로 둔다
    if (fieldVisible(active)) return;
    sc.scrollTop = cur; // 정말 가려졌으면 iOS가 옮긴 자리를 받아들인다
    pos.set(sc, cur);
  };

  const opt = { capture: true, passive: true } as const;
  window.addEventListener('touchmove', userScroll, opt);
  window.addEventListener('wheel', userScroll, opt);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointerDown, opt);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('scroll', onScroll, opt);
  return () => {
    window.removeEventListener('touchmove', userScroll, opt);
    window.removeEventListener('wheel', userScroll, opt);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointerDown, opt);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('scroll', onScroll, opt);
  };
}
