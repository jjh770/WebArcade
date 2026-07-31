/* ============================================================
   bgDecor — 배경 광원이 포인터를 따라간다
   ------------------------------------------------------------
   순수 장식이다. 게임 tick·시드·판정·동기화와 무관하며, 이 파일이 없어도
   배경(격자 + 느린 광원)은 CSS만으로 그대로 돈다.

   UI_MOTION.md의 "CSS 우선, 포인터 좌표가 필요할 때만 TS" 예외에 해당한다.
   지켜야 할 것:
   - 정밀 포인터에서만. 터치는 커서가 없어 광원이 마지막 탭 자리에 굳는다.
   - prefers-reduced-motion에서는 아예 안 붙인다.
   - 매 프레임 DOM을 측정하지 않는다 — 좌표는 이벤트가 준 값만 쓴다.
   - 목표에 닿으면 rAF를 멈춘다. 배경 장식이 유휴 상태에서 계속 돌면 안 된다.
   ============================================================ */

/** 한 프레임에 목표로 다가가는 비율. 낮을수록 늦게 따라와 무거운 느낌. */
const FOLLOW = 0.055;

/** 목표와 이만큼(px) 안이면 도착으로 보고 루프를 멈춘다. */
const SETTLE_PX = 0.5;

/** 포인터가 창을 벗어났을 때 광원이 돌아갈 자리(뷰포트 비율). */
const REST = { x: 0.3, y: 0.28 };

export type Point = { x: number; y: number };

/** 한 프레임 분 추종. DOM을 모르는 순수 함수라 테스트로 수렴을 확인할 수 있다.
 *  done이면 목표에 스냅하고 호출자가 루프를 멈춘다 — 0.001px씩 영원히 다가가는
 *  꼬리를 남기면 배경 장식 때문에 rAF가 계속 돈다. */
export function followStep(current: Point, target: Point, follow = FOLLOW): { next: Point; done: boolean } {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (Math.abs(dx) < SETTLE_PX && Math.abs(dy) < SETTLE_PX) return { next: { ...target }, done: true };
  return { next: { x: current.x + dx * follow, y: current.y + dy * follow }, done: false };
}

export function initBgDecor(spot: HTMLElement): void {
  // 터치·펜만 있는 환경, 그리고 모션을 줄이려는 사용자에게는 붙이지 않는다.
  if (!matchMedia("(pointer: fine)").matches) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const rest = (): { x: number; y: number } => ({
    x: innerWidth * REST.x,
    y: innerHeight * REST.y,
  });

  let target = rest();
  let current = { ...target };
  let frame = 0;

  const apply = (): void => {
    spot.style.setProperty("--spot-x", `${Math.round(current.x)}px`);
    spot.style.setProperty("--spot-y", `${Math.round(current.y)}px`);
  };

  const step = (): void => {
    const { next, done } = followStep(current, target);
    current = next;
    apply();
    frame = done ? 0 : requestAnimationFrame(step); // 도착하면 루프를 접는다.
  };

  const aim = (x: number, y: number): void => {
    // 플레이 중엔 장식이 display:none이라 따라갈 이유가 없다.
    if (document.body.classList.contains("playing")) return;
    target = { x, y };
    if (!frame) frame = requestAnimationFrame(step);
  };

  apply();
  addEventListener("pointermove", (e) => aim(e.clientX, e.clientY), { passive: true });
  // 창을 벗어나면 제자리로 — 커서가 없는데 광원만 구석에 남아 있으면 어색하다.
  addEventListener("pointerleave", () => {
    const home = rest();
    aim(home.x, home.y);
  });
  addEventListener("resize", () => {
    if (frame) return; // 따라가는 중이면 다음 pointermove가 어차피 갱신한다.
    current = target = rest();
    apply();
  });
}
