/* ============================================================
   playLayout — 플레이 영역의 크기 배분
   ------------------------------------------------------------
   메인 캔버스의 **표시 크기(CSS px)** 를 정하는 유일한 곳이다. 캔버스 해상도
   (백킹스토어)는 Canvas2DRenderer가 이 크기를 읽어 DPR만큼 맞춘다 — 소유권이
   갈려 있다. 게임 좌표계(논리 800x800)는 화면 크기와 무관하게 불변이다.

   ⚠️ 여백·간격·조작 영역 높이는 **CSS가 정본이다.** 여기서는 계산된 값을 읽기만
      한다. 그래서 폰에서 여백을 줄이거나, 노치를 피하거나, 조작면이 떠서 아래
      패딩이 커져도 판 크기가 저절로 따라온다 — 숫자를 양쪽에 적어두지 않는다.
   ============================================================ */

import { byId } from "./dom";

/** 이 폭 미만이면 관전 칼럼을 접고 메인 화면에 공간을 전부 준다(모바일·좁은 창). */
const NARROW_VIEWPORT = 900;
/** 관전 칼럼 폭 = 뷰포트 폭의 이 비율, 단 [min, max]로 제한. */
const SIDE_WIDTH_RATIO = 0.18;
const SIDE_WIDTH_MIN = 150;
const SIDE_WIDTH_MAX = 260;

/** 플레이 영역 전체 레이아웃. 각 캔버스의 **표시 크기(CSS px)** 만 정한다.
 *  - 관전 칼럼: 뷰포트에 비례(좁으면 아예 접음). 메인보다 먼저 정해야 남는 폭이 나온다.
 *  - 메인: 남는 공간에서 게임 비율(aspect)을 유지하는 최대 사각형(레터박스). */
export function layoutPlayArea(aspect: number): void {
  const narrow = window.innerWidth < NARROW_VIEWPORT;
  const play = byId("play");
  play.classList.toggle("narrow", narrow);

  // (창 크기가 바뀔 때만 재는 것이라 매 프레임 측정이 아니다.)
  const style = getComputedStyle(play);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const gap = parseFloat(style.columnGap) || 0;

  // 접히면 칼럼이 display:none → flex gap도 사라지므로 계산에서 함께 뺀다.
  const sideWidth = narrow
    ? 0
    : clamp(window.innerWidth * SIDE_WIDTH_RATIO, SIDE_WIDTH_MIN, SIDE_WIDTH_MAX);
  const sideViews = byId("side-views");
  sideViews.style.setProperty("--side-w", `${Math.floor(sideWidth)}px`);
  sideViews.style.setProperty("--side-h", `${Math.floor(sideWidth / aspect)}px`);

  const availableWidth = window.innerWidth - padX - sideWidth - (narrow ? 0 : gap);
  const availableHeight = window.innerHeight - padY;
  let width = Math.max(1, availableWidth);
  let height = width / aspect;
  if (height > availableHeight) {
    height = Math.max(1, availableHeight);
    width = height * aspect;
  }
  const game = byId<HTMLCanvasElement>("game");
  game.style.width = `${Math.floor(width)}px`;
  game.style.height = `${Math.floor(height)}px`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
