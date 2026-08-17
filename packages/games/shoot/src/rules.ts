/* ============================================================
   rules — 한 발이 점수가 되는 과정을 순수 함수로
   ------------------------------------------------------------
   "이 자리를 쐈다"를 넣으면 맞았는지, 몇 점인지, 명중률이 어떻게 되는지가 나온다.
   캔버스도 tick 루프도 없다.

   ⚠️ **헛방 감점이 중심 규칙이다**(config 주석 참조). 판정에서 이걸 빼면 연타가
      최적이 되어 게임이 사라진다.
   ⚠️ 점수는 0 아래로 안 내려간다. 순위표에 음수가 오르면 읽는 사람이 규칙을 의심한다.
   ============================================================ */

import { shootConfig as C } from "./config";
import type { Target } from "./targets";

export interface ShootState {
  /** 지금까지 쌓은 점수 = 순위 기록. */
  readonly score: number;
  /** 쏜 횟수. */
  readonly shots: number;
  /** 그중 맞은 횟수. */
  readonly hits: number;
}

export const INITIAL: ShootState = { score: 0, shots: 0, hits: 0 };

/** 지금 명중률(0~1). **한 발도 안 쐈으면 1이다** — 시작하자마자 0%가 떠서 게이지가
 *  빨갛게 우는 건 사실도 아니고 겁만 준다. */
export function accuracyOf(state: ShootState): number {
  return state.shots === 0 ? 1 : state.hits / state.shots;
}

/** 이 표적을 지금 맞히면 몇 점인가. 뜬 직후가 가장 높고 사라지기 직전이 가장 낮다.
 *  ⚠️ 수명이 0이하인 표적은 없지만, 있어도 0으로 나누지 않는다. */
export function pointsFor(target: Target, tick: number): number {
  const left = target.life <= 0 ? 0 : (target.bornTick + target.life - tick) / target.life;
  return C.hitPoints + Math.round(C.speedBonus * Math.min(1, Math.max(0, left)));
}

/** 쏜 자리가 이 표적 안인가. **경계는 포함이다**(에임 추적의 isHit과 같은 이유 —
 *  보이는 원과 맞는 원이 달라지면 안 된다). */
export function covers(target: Target, x: number, y: number): boolean {
  return Math.hypot(x - target.x, y - target.y) <= C.radius;
}

/** 한 발이 맞힐 표적. 겹쳐 있으면 **중심이 가장 가까운 하나**만 맞는다 —
 *  한 발은 한 표적이다. 아무것도 없으면 null. */
export function targetUnder(candidates: readonly Target[], x: number, y: number): Target | null {
  let best: Target | null = null;
  let bestDistance = Infinity;
  for (const target of candidates) {
    if (!covers(target, x, y)) continue;
    const distance = Math.hypot(x - target.x, y - target.y);
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

export interface ShotOutcome {
  readonly state: ShootState;
  /** 맞은 표적(없으면 null = 헛방). */
  readonly hit: Target | null;
  /** 이번 발로 오른 점수. 헛방이면 음수, 다만 실제로 깎인 만큼이다
   *  (점수가 0에 붙어 있으면 덜 깎인다). */
  readonly gained: number;
}

/** 한 발 쏜다. candidates는 **지금 떠 있고 아직 안 맞은** 표적들이다 —
 *  이미 맞힌 표적을 거르는 일은 게임이 한다(그건 사람마다 다른 사정이라 월드가 아니다). */
export function shoot(
  state: ShootState,
  candidates: readonly Target[],
  x: number,
  y: number,
  tick: number,
): ShotOutcome {
  const hit = targetUnder(candidates, x, y);
  if (hit) {
    const gained = pointsFor(hit, tick);
    return {
      state: { score: state.score + gained, shots: state.shots + 1, hits: state.hits + 1 },
      hit,
      gained,
    };
  }
  const score = Math.max(0, state.score - C.missPenalty);
  return {
    state: { score, shots: state.shots + 1, hits: state.hits },
    hit: null,
    gained: score - state.score,
  };
}

/** 남은 시간(tick). 0이면 판이 끝났다. */
export function ticksLeft(tick: number): number {
  return Math.max(0, C.timeLimitTicks - tick);
}

/** 판이 끝났는가. 시간이 유일한 끝이다 — 이 게임에도 죽음은 없다. */
export function isOver(tick: number): boolean {
  return ticksLeft(tick) <= 0;
}
