/* ============================================================
   targets — 표적이 언제 어디 뜨는가를 순수 함수로
   ------------------------------------------------------------
   시드만 있으면 몇 번째 표적이 언제 어디에 뜨는지가 나온다. 캔버스도 입력도 없어서
   Node에서 전부 시험할 수 있다(에임 추적의 targetPath와 같은 결).

   ⚠️ **출현표는 내 사격에 조금도 좌우되지 않는다.** 맞히면 다음이 뜨는 방식으로
      만들 수도 있었지만, 그러면 잘 쏘는 사람과 못 쏘는 사람이 **서로 다른 판**을 보게
      된다. 순위표가 같은 판을 전제로 세워지고 관전은 남의 화면을 내 월드로 그리므로,
      그 둘이 동시에 무너진다. 그래서 표는 시드로 고정하고, **맞힌 표적은 내 화면에서만
      사라진다**(ShootGame이 따로 기억한다).

   그래서 표적은 겹쳐 뜰 수 있다. 뒤로 갈수록 간격이 수명보다 짧아지므로 후반에는
   둘씩 떠 있는 구간이 생긴다 — 난이도가 오르는 방식이 이것이다.
   ============================================================ */

import { SeededRNG } from "@arcade/shared";
import { shootConfig as C } from "./config";

export type Target = {
  /** 몇 번째 표적인가(0부터). 맞힌 것을 기억할 때의 열쇠다. */
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** 뜬 tick. */
  readonly bornTick: number;
  /** 떠 있는 시간(tick). bornTick + life가 되면 사라진다. */
  readonly life: number;
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** i번째 표적이 뜬 뒤 다음 표적까지의 간격(tick). */
export function intervalFor(index: number): number {
  const t = Math.min(1, index / C.rampTargets);
  return Math.round(lerp(C.startIntervalTicks, C.endIntervalTicks, t));
}

/** i번째 표적이 떠 있는 시간(tick). */
export function lifeFor(index: number): number {
  const t = Math.min(1, index / C.rampTargets);
  return Math.round(lerp(C.startLifeTicks, C.endLifeTicks, t));
}

/** i번째 표적이 뜨는 tick. 앞의 간격들을 더한 값이다. */
export function bornTickFor(index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += intervalFor(i);
  return at;
}

/** 후보를 몇 개 뽑아 볼 것인가. **개수를 고정하는 게 중요하다** — "될 때까지 다시 뽑기"로
 *  만들면 난수 소비 횟수가 자리에 따라 달라져, 같은 시드가 같은 표를 못 낸다. */
const TRIES = 3;

/** i번째 표적의 자리. 직전 표적에서 minGap만큼 떨어진 후보를 앞에서부터 고르고,
 *  셋 다 가까우면 마지막 것을 쓴다(가끔 가까이 뜨는 편이 난수를 흔드는 것보다 낫다). */
export function pointFor(seed: number, index: number): { x: number; y: number } {
  const rng = new SeededRNG((seed ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0);
  const previous = index > 0 ? pointFor(seed, index - 1) : { x: C.screenWidth / 2, y: C.screenHeight / 2 };

  let candidate = { x: 0, y: 0 };
  for (let attempt = 0; attempt < TRIES; attempt++) {
    candidate = {
      x: rng.range(C.margin, C.screenWidth - C.margin),
      y: rng.range(C.margin, C.screenHeight - C.margin),
    };
    if (Math.hypot(candidate.x - previous.x, candidate.y - previous.y) >= C.minGap) break;
  }
  return candidate;
}

/** i번째 표적. 자리·시각·수명이 전부 시드와 번호에서 나온다. */
export function targetAt(seed: number, index: number): Target {
  const { x, y } = pointFor(seed, index);
  return { index, x, y, bornTick: bornTickFor(index), life: lifeFor(index) };
}

/** 이 tick에 판 위에 떠 있는 표적들(맞았는지는 여기서 모른다 — 그건 각자의 사정이다).
 *  ⚠️ 0번부터 훑는다. 한 판이 30초라 표적은 많아야 마흔몇 개고, 그 정도 되짚기는 매
 *     프레임 해도 표가 안 난다 — 대신 어느 tick을 묻든 답이 같다는 성질을 지킨다. */
export function liveTargets(seed: number, tick: number): Target[] {
  const out: Target[] = [];
  for (let index = 0; ; index++) {
    const born = bornTickFor(index);
    if (born > tick) break; // 아직 안 뜬 표적 — 뒤는 더 늦게 뜬다.
    if (born + lifeFor(index) > tick) out.push(targetAt(seed, index));
  }
  return out;
}

/** 한 판에 뜨는 표적 수. 제한시간 안에 뜬 것만 센다. */
export function totalTargets(): number {
  let index = 0;
  while (bornTickFor(index) < C.timeLimitTicks) index++;
  return index;
}
