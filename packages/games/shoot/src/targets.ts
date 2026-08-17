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

/** 그 tick이 몇 번째 10초 구간인가(마지막 구간을 넘어가면 마지막으로 친다). */
export function phaseAt(tick: number): number {
  const phase = Math.floor(Math.max(0, tick) / C.phaseTicks);
  return Math.min(C.phaseIntervals.length - 1, phase);
}

/** 이 시각에 뜨는 표적의 다음 표적까지의 간격(tick). */
export function intervalAt(tick: number): number {
  return C.phaseIntervals[phaseAt(tick)]!;
}

/** 이 시각에 뜨는 표적이 떠 있는 시간(tick). */
export function lifeAt(tick: number): number {
  return C.phaseLives[phaseAt(tick)]!;
}

/** 표적이 뜨는 시각표. **시드와 무관하다**(간격은 시계만 본다) — 그래서 한 번 만들어
 *  두고 계속 쓴다. 판 끝을 넘는 것 하나까지 담아 "더는 없다"를 바로 알 수 있게 한다.
 *  ⚠️ 예전엔 매번 앞에서부터 더했다. 표적이 마흔 개일 땐 티가 안 났는데 판이 60초가 되며
 *     아흔 개를 넘자 **매 프레임 제곱으로** 훑는 꼴이 됐다(liveTargets가 이걸 부른다). */
let bornTicks: number[] | null = null;

function schedule(): number[] {
  if (bornTicks) return bornTicks;
  const out: number[] = [];
  let at = 0;
  while (at < C.timeLimitTicks) {
    out.push(at);
    at += intervalAt(at);
  }
  out.push(at); // 판 끝을 넘는 첫 표적 — 여기까지 오면 그만 본다는 표시
  bornTicks = out;
  return out;
}

/** i번째 표적이 뜨는 tick. 앞의 간격들을 더한 값이다.
 *  ⚠️ 간격이 **시각**으로 정해지는데도 서로 물지 않는다: i번째의 간격은 i번째가 뜬 시각이
 *     정하고, 그 시각은 앞의 것들만 더하면 나온다. 그래서 앞에서부터 한 번 훑으면 끝이다. */
export function bornTickFor(index: number): number {
  const table = schedule();
  if (index < table.length) return table[index]!;
  // 표에 없는 번호(판이 끝난 뒤)는 마지막 간격으로 이어 붙인다.
  const last = table[table.length - 1]!;
  return last + intervalAt(last) * (index - table.length + 1);
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
  const bornTick = bornTickFor(index);
  return { index, x, y, bornTick, life: lifeAt(bornTick) };
}

/** 이 tick에 판 위에 떠 있는 표적들(맞았는지는 여기서 모른다 — 그건 각자의 사정이다).
 *  ⚠️ 0번부터 훑는다. 한 판이 30초라 표적은 많아야 마흔몇 개고, 그 정도 되짚기는 매
 *     프레임 해도 표가 안 난다 — 대신 어느 tick을 묻든 답이 같다는 성질을 지킨다. */
export function liveTargets(seed: number, tick: number): Target[] {
  const table = schedule();
  const out: Target[] = [];
  for (let index = 0; index < table.length; index++) {
    const born = table[index]!;
    if (born > tick) break; // 아직 안 뜬 표적 — 뒤는 더 늦게 뜬다.
    if (born + lifeAt(born) > tick) out.push(targetAt(seed, index));
  }
  return out;
}

/** 한 판에 뜨는 표적 수. 제한시간 안에 뜬 것만 센다(시각표의 마지막 하나는 넘긴 것이다). */
export function totalTargets(): number {
  return schedule().length - 1;
}
