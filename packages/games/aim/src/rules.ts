/* ============================================================
   rules — 겨눔이 점수가 되는 과정을 순수 함수로
   ------------------------------------------------------------
   "지금 표적 안에 있나"라는 사실 하나를 매 tick 넣으면 점수와 배수가 굴러간다.
   캔버스도 좌표도 없다 — 여기 있는 건 **붙들고 있는 시간의 규칙**뿐이다.

   ⚠️ 배수는 붙들고 있는 시간으로 오르고, **놓쳐도 곧바로 무너지지 않는다.**
      유예(comboGraceTicks) 안에 다시 잡으면 이어진다. 이게 이 게임의 공정성
      장치다 — 한 프레임 삐끗에 4배가 통째로 날아가면, 미세 조정이 굵은 입력
      (손가락)이 구조적으로 불리해진다. config 주석 참조.

   ⚠️ 놓친 동안은 점수가 **안 오른다.** 유예는 배수를 지켜 줄 뿐 점수를 주지 않는다 —
      그렇지 않으면 표적을 놓친 채로도 벌이가 생긴다.
   ============================================================ */

import { aimConfig as C } from "./config";

export interface AimState {
  /** 지금까지 쌓은 점수 = 순위 기록. */
  readonly score: number;
  /** 끊기지 않고 붙들고 있는 시간(tick). 배수는 여기서 나온다. */
  readonly holdTicks: number;
  /** 지금 놓친 지 몇 tick인가. 0이면 잡고 있다는 뜻이다. */
  readonly missTicks: number;
  /** 이번 판에서 표적 안에 있던 총 tick. 기록이 아니라 보여 줄 값이다(적중률). */
  readonly hitTicks: number;
}

export const INITIAL: AimState = { score: 0, holdTicks: 0, missTicks: 0, hitTicks: 0 };

/** 지금 배수(1~maxCombo). 붙들고 있는 시간이 한 단계씩 올린다. */
export function comboOf(state: AimState): number {
  return Math.min(C.maxCombo, 1 + Math.floor(state.holdTicks / C.comboStepTicks));
}

/** 배수가 얼마나 차올랐는가(0~1). HUD 게이지에 그대로 쓴다.
 *  상한에 닿으면 1로 멈춘다 — 더 붙들어도 게이지가 넘치지는 않는다. */
export function comboGauge(state: AimState): number {
  const full = C.comboStepTicks * (C.maxCombo - 1);
  return full <= 0 ? 1 : Math.min(1, state.holdTicks / full);
}

/** 한 tick 굴린다. hit은 "이번 tick에 조준점이 표적 안에 있었나".
 *  ⚠️ 점수는 **이번 tick의 배수**로 준다(올라간 뒤가 아니라). 그래서 첫 tick은 1점이고,
 *     단계가 오르는 순간부터 새 배수가 붙는다. */
export function step(state: AimState, hit: boolean): AimState {
  if (hit) {
    return {
      score: state.score + comboOf(state),
      holdTicks: state.holdTicks + 1,
      missTicks: 0,
      hitTicks: state.hitTicks + 1,
    };
  }
  const missTicks = state.missTicks + 1;
  return {
    score: state.score,
    // 유예를 넘겨 놓쳤으면 쌓아 둔 시간이 사라진다.
    holdTicks: missTicks > C.comboGraceTicks ? 0 : state.holdTicks,
    missTicks,
    hitTicks: state.hitTicks,
  };
}

/** 조준점이 표적 안에 있는가. **경계는 포함이다** — 테두리에 정확히 닿은 것을 빗나감으로
 *  치면 보이는 원과 맞는 원이 미묘하게 달라진다. */
export function isHit(
  aimX: number,
  aimY: number,
  target: { readonly x: number; readonly y: number; readonly radius: number },
): boolean {
  return Math.hypot(aimX - target.x, aimY - target.y) <= target.radius;
}

/** 남은 시간(tick). 0이면 판이 끝났다. */
export function ticksLeft(tick: number): number {
  return Math.max(0, C.timeLimitTicks - tick);
}

/** 판이 끝났는가. 시간이 유일한 끝이다 — 이 게임에는 죽음이 없다. */
export function isOver(tick: number): boolean {
  return ticksLeft(tick) <= 0;
}
