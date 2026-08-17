/* ============================================================
   targetPath — 표적이 언제 어디에 있는가를 순수 함수로
   ------------------------------------------------------------
   시드와 tick만 있으면 표적의 자리가 나온다. 캔버스도 입력도 없어서 Node에서
   전부 시험할 수 있다(숫자 야구의 rules, 커브 피버의 worldGen과 같은 결).

   ⚠️ **플레이어 입력이 여기 한 글자도 안 들어간다.** 그래서 같은 방의 모두가 같은
      표적을 본다 — 이 게임이 네 게임 중 어긋날 여지가 가장 적은 이유다. 겨누는 실력은
      월드를 바꾸지 않고 점수만 바꾼다.

   표적은 **구간(leg)**으로 움직인다. 한 구간은 "지금 자리 → 다음 자리"를 정해진
   tick 동안 건너가는 것이고, 구간마다 건너가는 **모양**이 다르다(아래 SHAPES).
   구간의 끝점이 다음 구간의 시작점이라 경로가 끊기지 않는다.

   ⚠️ 다음 자리는 **지금 자리에서 각도와 거리를 뽑아** 정한다. 판 안에서 점 하나를
      그냥 뽑는 방식이 아니다 — 그러면 "거의 제자리"인 구간이 섞여 나오고, 그건
      겨눌 필요가 없는 공짜 시간이 된다.
   ⚠️ 판 밖으로 나가는 각도는 **쓰기 전에 거른다.** 처음에는 나간 값을 접어 넣었는데
      (반사), 접힌 점이 출발점 근처에 떨어져 26px짜리 구간이 나왔다 — 없애려던 공짜
      구간이 접는 과정에서 되살아난 것이다. 지금은 뽑은 각도에서 45도씩 돌려 가며
      판 안에 떨어지는 첫 방향을 쓴다. 거리는 뽑은 그대로 지켜진다.
      ⚠️ 후보가 늘 하나는 있다: 판 안쪽 폭(640)이 최대 이동 거리(maxTravel)보다 넓어
         어느 자리에서든 가운데 쪽으로는 그만큼 갈 자리가 남는다.
   ============================================================ */

import { SeededRNG } from "@arcade/shared";
import { aimConfig as C } from "./config";

/** 한 구간을 건너가는 모양. u(0~1)를 받아 진행도(0~1)를 돌려주는 순수 함수다.
 *  같은 리듬만 반복되면 몸이 박자를 외워 겨누기가 아니라 예측이 된다. */
const SHAPES = [
  /** 부드럽게 출발해 부드럽게 선다. 따라가기 가장 쉬운 구간. */
  (u: number) => u * u * (3 - 2 * u),
  /** 일정한 속도로 지나간다. 속도가 안 변해 눈으로 앞지르기 좋다. */
  (u: number) => u,
  /** 앞의 40%에서 다 가 버리고 나머지는 멈춰 기다린다 — 탁 튀고 서는 구간.
   *  놓치기 가장 쉬운 대신, 선 뒤에는 다시 잡을 시간을 준다. */
  (u: number) => (u < 0.4 ? (u / 0.4) * (u / 0.4) * (3 - 2 * (u / 0.4)) : 1),
] as const;

export type Leg = {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  /** 이 구간이 시작하는 tick. */
  readonly startTick: number;
  /** 이 구간의 길이(tick). */
  readonly ticks: number;
  /** SHAPES의 몇 번째 모양인가. */
  readonly shape: number;
};

export type TargetAt = {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/** 판 안(여백 안쪽)인가. */
function inside(x: number, y: number): boolean {
  return (
    x >= C.margin &&
    x <= C.screenWidth - C.margin &&
    y >= C.margin &&
    y <= C.screenHeight - C.margin
  );
}

/** 한 구간에서 시도해 보는 방향의 수. 45도씩 돌려 가며 판 안에 떨어지는 첫 방향을 쓴다. */
const DIRECTIONS = 8;

/** i번째 구간의 길이(tick). 구간이 지날수록 짧아진다(난이도 상승). */
export function legTicks(index: number): number {
  const t = Math.min(1, index / C.rampLegs);
  return Math.round(lerp(C.startLegTicks, C.endLegTicks, t));
}

/** 지난 시간에 따른 표적 반지름(px). 구간이 아니라 **시각**으로 재므로 판 전체에
 *  걸쳐 고르게 줄어든다. */
export function radiusAt(tick: number): number {
  const t = Math.min(1, Math.max(0, tick / C.timeLimitTicks));
  return lerp(C.startRadius, C.endRadius, t);
}

/** i번째 구간에서 (x, y)를 떠나 갈 다음 자리와 건너갈 모양.
 *  시드와 구간 번호만으로 정해진다 — 구간을 몇 번 계산하든 답이 같다. */
function stepFrom(seed: number, index: number, x: number, y: number): { x: number; y: number; shape: number } {
  const rng = new SeededRNG((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  const angle = rng.next() * Math.PI * 2;
  const distance = rng.range(C.minTravel, C.maxTravel);
  // ⚠️ RNG는 여기까지 **딱 세 번** 굴린다. 후보를 고르는 건 뽑은 값을 돌려 보는 것뿐이라
  //    소비 횟수가 자리에 따라 달라지지 않는다(같은 구간이면 언제나 같은 답).
  const shape = rng.int(SHAPES.length);

  for (let turn = 0; turn < DIRECTIONS; turn++) {
    const at = angle + (turn * Math.PI * 2) / DIRECTIONS;
    const x2 = x + Math.cos(at) * distance;
    const y2 = y + Math.sin(at) * distance;
    if (inside(x2, y2)) return { x: x2, y: y2, shape };
  }
  // 여기까지 오지 않는다(위 머리말 참조). 와도 판 안에는 있도록 자른다.
  return {
    x: clamp(x + Math.cos(angle) * distance, C.margin, C.screenWidth - C.margin),
    y: clamp(y + Math.sin(angle) * distance, C.margin, C.screenHeight - C.margin),
    shape,
  };
}

/** 그 tick이 속한 구간. 판 한가운데에서 출발해 구간을 하나씩 이어 붙여 찾는다.
 *  ⚠️ 처음부터 훑는다. 한 판이 45초라 구간은 많아야 예순몇 개고, 그 정도 되짚기는
 *     매 프레임 해도 표가 안 난다 — 대신 어느 tick을 묻든 답이 같다는 성질을 지킨다
 *     (커서를 들고 있으면 관전·되감기처럼 순서가 흐트러진 호출에서 어긋난다).
 *  ⚠️ 제한시간을 넘긴 tick은 마지막 순간으로 친다. 판이 끝난 뒤에도 화면은 한 프레임
 *     더 그려질 수 있고, 그때 표적이 사라지거나 튀면 안 된다. */
export function legAt(seed: number, tick: number): Leg {
  const want = Math.max(0, Math.min(tick, C.timeLimitTicks));
  let fromX = C.screenWidth / 2;
  let fromY = C.screenHeight / 2;
  let startTick = 0;
  for (let index = 0; ; index++) {
    const ticks = legTicks(index);
    const next = stepFrom(seed, index, fromX, fromY);
    if (want < startTick + ticks) {
      return { fromX, fromY, toX: next.x, toY: next.y, startTick, ticks, shape: next.shape };
    }
    fromX = next.x;
    fromY = next.y;
    startTick += ticks;
  }
}

/** 그 tick의 표적(중심과 반지름). 이 게임에서 "표적이 어디 있나"를 말하는 곳은 여기뿐이다 —
 *  판정도 그리기도 관전도 전부 이 함수를 본다. */
export function targetAt(seed: number, tick: number): TargetAt {
  const leg = legAt(seed, tick);
  const want = Math.max(0, Math.min(tick, C.timeLimitTicks));
  const u = leg.ticks <= 0 ? 1 : Math.min(1, (want - leg.startTick) / leg.ticks);
  const progress = SHAPES[leg.shape]!(u);
  return {
    x: lerp(leg.fromX, leg.toX, progress),
    y: lerp(leg.fromY, leg.toY, progress),
    radius: radiusAt(want),
  };
}
