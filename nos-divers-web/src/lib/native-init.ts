/**
 * 네이티브(iOS/Android) 빌드에서만 실행되는 초기화 코드.
 *
 * 1. StatusBar.setOverlaysWebView(true): WebView 가 시스템 UI(상태바/내비바)
 *    영역까지 그리도록 → CSS env(safe-area-inset-*) 가 정상 값 반환.
 * 2. iOS rubber-band overscroll / 화면 전체 드래그 차단 (글로벌 touchmove 가드).
 */

import { isNative } from "./platform";

export async function initNative(): Promise<void> {
  // iOS WebView 드래그 차단은 네이티브뿐 아니라 모바일 브라우저에서도 유효하므로
  // platform 체크 전에 적용 (데스크톱은 touchmove 미발생이라 영향 없음)
  installTouchMoveGuard();

  if (!isNative()) return;

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");

    // WebView 가 상태바 영역까지 그리도록
    await StatusBar.setOverlaysWebView({ overlay: true });

    // 다크/라이트 시스템 테마 추종은 추후 확장 가능
    await StatusBar.setStyle({ style: Style.Default });
  } catch (e) {
    console.warn("StatusBar init 실패:", e);
  }
}

/**
 * iOS WKWebView 에서 발생하는 화면 전체 드래그(rubber-band) 차단.
 *
 * Capacitor `DisallowOverscroll` + CSS `overscroll-behavior: none` 만으로는
 * 일부 시나리오 (모달 위, 빈 영역 터치, scrollHeight==clientHeight 인 .page 등)
 * 에서 여전히 페이지가 끌려간다. 이를 JS 로 보강:
 *
 * - touchmove 가 발생한 타깃에서 부모를 거슬러 올라가며 실제로 스크롤
 *   가능한 (scrollHeight > clientHeight 인 auto/scroll) 요소를 찾는다.
 * - 그런 요소를 못 찾으면 preventDefault → 페이지 전체 드래그 차단.
 * - 찾았어도 스크롤이 끝(상단 0 또는 하단 max)에 도달했고 거기서 더 끌면
 *   부모로 체인 전파되며 rubber-band 발생 → 이것도 차단.
 *
 * passive:false 로 등록해야 preventDefault 가 적용됨.
 */
function installTouchMoveGuard(): void {
  if (typeof document === "undefined") return;
  if ((window as any).__touchMoveGuardInstalled) return;
  (window as any).__touchMoveGuardInstalled = true;

  let startY = 0;
  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length > 0) startY = e.touches[0].clientY;
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length === 0) return;
      const currentY = e.touches[0].clientY;
      const dy = currentY - startY; // +면 아래로 드래그(=콘텐츠 위로 스크롤)

      // input/textarea 내부의 caret 이동 등 시스템 UI 는 그대로
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("input, textarea, select, canvas, [contenteditable]")) return;

      // 스크롤 가능한 가장 가까운 ancestor 찾기
      let el: HTMLElement | null = target;
      while (el && el !== document.body) {
        const style = getComputedStyle(el);
        const overflowY = style.overflowY;
        const scrollable =
          (overflowY === "auto" || overflowY === "scroll") &&
          el.scrollHeight > el.clientHeight;
        if (scrollable) {
          // 스크롤 끝(상/하) 에서 더 끌면 rubber-band → 차단
          const atTop = el.scrollTop <= 0;
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          if ((atTop && dy > 0) || (atBottom && dy < 0)) {
            if (e.cancelable) e.preventDefault();
          }
          return;
        }
        el = el.parentElement;
      }
      // 스크롤 가능한 부모가 없는 영역(빈 공간, 모달 오버레이 등) → 항상 차단
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
}
