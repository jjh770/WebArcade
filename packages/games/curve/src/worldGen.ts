/* ============================================================
   worldGen — 커브 피버의 판을 시드에서 짓는다
   ------------------------------------------------------------
   `init`에서 **한 번만** 도는 일들이다. 장애물을 뽑고, 시작 자리를 고르고,
   출발 방향을 정한다. 매 tick 도는 주행·충돌·렌더(CurveGame)와 수명이 완전히
   다르므로 따로 산다 — 죽림고수가 스폰 계열을 별도 파일로 둔 것과 같은 이유다.

   ⚠️ **RNG 소비 순서가 곧 판의 정체성이다.** 여기 함수들은 정해진 순서로
      불려야 하고(장애물 → 스폰 → 방향), 각 함수 안에서도 뽑는 순서를 바꾸면
      같은 시드가 다른 판이 된다. 클라마다 판이 갈리면 관전 화면이 어긋나고,
      순위 기록도 서로 다른 판의 기록이 된다.

   ⚠️ 장애물을 **먼저** 뽑는 이유: 장애물은 플레이어와 무관한 공통 월드이고,
      스폰은 인원수에 따라 달라진다. 순서가 뒤집히면 혼자 할 때와 여럿이 할 때
      장애물 배치가 갈린다.

   Math.random 없음. 모든 값이 넘겨받은 SeededRNG에서만 나온다.
   ============================================================ */

import type { SpawnContext } from "@arcade/shared";
import { SeededRNG } from "@arcade/shared";
import { curveConfig as C } from "./config";
import { SEG_HALF, HEAD_R, obstacleBlocks, obstacleClearance, type Obstacle } from "./obstacles";

const TAU = Math.PI * 2;

export type Spawn = { x: number; y: number };

/** 장애물을 시드에서 뽑는다. 벽붙은 선분 → 떠 있는 선분 → 원 기둥 → 다각형 순.
 *  ⚠️ 이 고정 순서를 지켜야 클라마다 같은 판이 나온다. */
export function generateObstacles(rng: SeededRNG): Obstacle[] {
  const { count, wallAttachedCount, minLength, maxLength, edgeMargin, circleCount, polygonCount } = C.obstacles;
  const out: Obstacle[] = [];
  const attached = Math.min(wallAttachedCount, count);
  // 처음 4개는 네 변(0=위 1=오른쪽 2=아래 3=왼쪽)에 하나씩 배정해 모든 변이
  // 최소 하나는 갖게 한다(둘레 어디로도 그냥 돌 수 없게). 나머지는 랜덤 변.
  for (let i = 0; i < attached; i++) {
    const wall = i < 4 ? i : rng.int(4);
    out.push(wallAttachedSegment(rng, wall));
  }
  for (let i = attached; i < count; i++) out.push(floatingSegment(rng, minLength, maxLength, edgeMargin));
  for (let i = 0; i < circleCount; i++) out.push(circlePillar(rng));
  for (let i = 0; i < polygonCount; i++) out.push(polygonRing(rng));
  return out;
}

/** 시작 자리를 고른다. 혼자면 예전과 똑같은 단일 스폰(RNG 소비가 바이트 단위로 동일),
 *  여럿이면 인원수만큼 서로 떨어진 자리를 결정론적으로 뽑아 내 순번의 것을 쓴다
 *  — 모든 클라가 같은 집합을 얻으므로 시작점이 겹치지 않는다. */
export function pickSpawn(rng: SeededRNG, obstacles: readonly Obstacle[], self?: SpawnContext): Spawn {
  if (!self || self.count <= 1) return pickSafeSpawn(rng, obstacles);
  const spawns = generateSpawns(rng, obstacles, self.count);
  return spawns[clamp(self.index, 0, self.count - 1)]!;
}

/** 바깥 벽 한 곳(wall: 0=위 1=오른쪽 2=아래 3=왼쪽)에 한쪽 끝을 붙이고
 *  안쪽으로 뻗는 선분(벽에서 자란 돌기). */
function wallAttachedSegment(rng: SeededRNG, wall: number): Obstacle {
  const { minLength, maxLength } = C.obstacles;
  const m = C.wallMargin;
  const W = C.screenWidth;
  const H = C.screenHeight;
  const pad = 80; // 벽을 따라 모서리에서 이만큼 떨어진 구간에만 붙인다.
  let bx = 0;
  let by = 0;
  let inward = 0; // 안쪽을 향하는 기준 각도
  if (wall === 0) { bx = rng.range(m + pad, W - m - pad); by = m; inward = Math.PI / 2; }
  else if (wall === 1) { bx = W - m; by = rng.range(m + pad, H - m - pad); inward = Math.PI; }
  else if (wall === 2) { bx = rng.range(m + pad, W - m - pad); by = H - m; inward = -Math.PI / 2; }
  else { bx = m; by = rng.range(m + pad, H - m - pad); inward = 0; }

  // 안쪽 방향에 ±34° 변화를 줘 수직 스파이크가 아니라 비스듬하게도 자라게 한다.
  const angle = inward + rng.range(-0.6, 0.6);
  const length = rng.range(minLength, maxLength);
  const fx = clamp(bx + Math.cos(angle) * length, m, W - m);
  const fy = clamp(by + Math.sin(angle) * length, m, H - m);
  return { kind: "segment", x1: bx, y1: by, x2: fx, y2: fy };
}

/** 판 안쪽에 떠 있는 선분. 끝점은 바깥 벽에서 edgeMargin만큼 안쪽. */
function floatingSegment(rng: SeededRNG, minLength: number, maxLength: number, edgeMargin: number): Obstacle {
  const lo = C.wallMargin + edgeMargin;
  const hiX = C.screenWidth - C.wallMargin - edgeMargin;
  const hiY = C.screenHeight - C.wallMargin - edgeMargin;
  const x1 = rng.range(lo, hiX);
  const y1 = rng.range(lo, hiY);
  const angle = rng.next() * TAU;
  const length = rng.range(minLength, maxLength);
  const x2 = clamp(x1 + Math.cos(angle) * length, lo, hiX);
  const y2 = clamp(y1 + Math.sin(angle) * length, lo, hiY);
  return { kind: "segment", x1, y1, x2, y2 };
}

/** 꽉 찬 원 기둥. 원 전체가 안전 영역 안에 들어오도록 중심을 반지름만큼 띄운다. */
function circlePillar(rng: SeededRNG): Obstacle {
  const { circleMinRadius, circleMaxRadius } = C.obstacles;
  const r = rng.range(circleMinRadius, circleMaxRadius);
  const cx = rng.range(C.wallMargin + r, C.screenWidth - C.wallMargin - r);
  const cy = rng.range(C.wallMargin + r, C.screenHeight - C.wallMargin - r);
  return { kind: "circle", cx, cy, r };
}

/** 속 빈 다각형(정다각형 + 전체 회전). 윤곽선만 벽이라 안에 들어갔다 나올 수 있다. */
function polygonRing(rng: SeededRNG): Obstacle {
  const { polygonMinRadius, polygonMaxRadius, polygonMinSides, polygonMaxSides } = C.obstacles;
  const sides = polygonMinSides + rng.int(polygonMaxSides - polygonMinSides + 1);
  const radius = rng.range(polygonMinRadius, polygonMaxRadius);
  // 도형 전체가 안전 영역에 들어오도록 중심을 반지름만큼 띄운다.
  const cx = rng.range(C.wallMargin + radius, C.screenWidth - C.wallMargin - radius);
  const cy = rng.range(C.wallMargin + radius, C.screenHeight - C.wallMargin - radius);
  const rot = rng.next() * TAU;
  const pts: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * TAU) / sides;
    pts.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
  }
  return { kind: "polygon", pts };
}

/** 시작 위치를 뽑는다. spawnClearance를 만족하는 자리를 찾으면 즉시 쓰고,
 *  못 찾으면(밀도가 높아 꽉 찬 경우) **그나마 가장 트인** 후보를 쓴다.
 *  ⚠️ 예전엔 못 찾으면 마지막 랜덤 후보를 그대로 써서, 밀도가 오르자
 *     벽·장애물 코앞에 스폰돼 즉사하는 일이 생겼다. */
function pickSafeSpawn(rng: SeededRNG, obstacles: readonly Obstacle[]): Spawn {
  const minX = C.wallMargin + C.spawnInset;
  const maxX = C.screenWidth - C.wallMargin - C.spawnInset;
  const minY = C.wallMargin + C.spawnInset;
  const maxY = C.screenHeight - C.wallMargin - C.spawnInset;

  let best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  let bestClear = -Infinity;
  for (let attempt = 0; attempt < C.obstacles.maxSpawnAttempts; attempt++) {
    const x = rng.range(minX, maxX);
    const y = rng.range(minY, maxY);
    // 이 후보에서 가장 가까운 장애물까지의 여유거리.
    let minClear = Infinity;
    for (const ob of obstacles) {
      const c = obstacleClearance(ob, x, y, SEG_HALF);
      if (c < minClear) minClear = c;
    }
    if (minClear >= C.obstacles.spawnClearance) return { x, y }; // 충분히 트임 → 확정
    if (minClear > bestClear) {
      bestClear = minClear;
      best = { x, y };
    }
  }
  return best; // 기준 미달이지만 표본 중 가장 트인 자리
}

/** 멀티용: 서로 떨어진 스폰 count개를 순서대로 뽑는다. 앞서 정한 자리들과도
 *  멀어지도록 골라 시작점이 겹치지 않게 한다. 결정론적이라 모든 클라가 같은
 *  집합을 얻고, 각자 자기 순번(index)의 자리를 쓴다. */
function generateSpawns(rng: SeededRNG, obstacles: readonly Obstacle[], count: number): Spawn[] {
  const chosen: Spawn[] = [];
  for (let i = 0; i < count; i++) chosen.push(pickSpreadSpawn(rng, obstacles, chosen));
  return chosen;
}

/** 장애물에서 충분히 트이면서 already(이미 고른 스폰들)에서 가장 먼 자리를 고른다.
 *  트인 후보가 하나라도 있으면 그중 남들과 가장 먼 것을, 하나도 없으면(꽉 참)
 *  그나마 장애물 여유가 가장 큰 자리를 쓴다. */
function pickSpreadSpawn(rng: SeededRNG, obstacles: readonly Obstacle[], already: readonly Spawn[]): Spawn {
  const minX = C.wallMargin + C.spawnInset;
  const maxX = C.screenWidth - C.wallMargin - C.spawnInset;
  const minY = C.wallMargin + C.spawnInset;
  const maxY = C.screenHeight - C.wallMargin - C.spawnInset;

  let bestGood: Spawn | null = null;
  let bestGoodDist = -Infinity; // 트인 후보 중 남들과의 최소거리 최대화
  let bestBad = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  let bestBadClear = -Infinity; // 트인 후보가 없을 때의 폴백(장애물 여유 최대)

  for (let attempt = 0; attempt < C.obstacles.maxSpawnAttempts; attempt++) {
    const x = rng.range(minX, maxX);
    const y = rng.range(minY, maxY);
    let obClear = Infinity;
    for (const ob of obstacles) {
      const c = obstacleClearance(ob, x, y, SEG_HALF);
      if (c < obClear) obClear = c;
    }
    if (obClear >= C.obstacles.spawnClearance) {
      let peerDist = Infinity;
      for (const o of already) {
        const d = Math.hypot(x - o.x, y - o.y);
        if (d < peerDist) peerDist = d;
      }
      if (peerDist > bestGoodDist) {
        bestGoodDist = peerDist;
        bestGood = { x, y };
      }
    } else if (obClear > bestBadClear) {
      bestBadClear = obClear;
      bestBad = { x, y };
    }
  }
  return bestGood ?? bestBad;
}

/** 시작 위치에서 사방을 훑어 "가장 트인 방향"을 고른다. 각 후보 방향으로 짧은
 *  탐침을 쏘아 벽·장애물에 막힐 때까지의 거리를 재고, 그게 가장 큰 방향을 쓴다.
 *  rng는 후보 각도의 시작 오프셋 하나만 소비한다(판마다 방향이 달라지게).
 *
 *  ⚠️ 이게 없으면 랜덤 방향이 벽·장애물을 정면으로 향해 시작하자마자 죽는다. */
export function chooseOpenHeading(rng: SeededRNG, obstacles: readonly Obstacle[], x: number, y: number): number {
  const { headingSamples, spawnClearance } = C.obstacles;
  const offset = rng.next() * TAU;
  const step = 8; // 탐침 간격(px)
  const maxProbe = spawnClearance + 40;

  let bestAngle = offset;
  let bestClear = -1;
  for (let k = 0; k < headingSamples; k++) {
    const a = offset + (k * TAU) / headingSamples;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    let clear = maxProbe;
    for (let d = step; d <= maxProbe; d += step) {
      if (blockedAt(obstacles, x + cos * d, y + sin * d)) {
        clear = d;
        break;
      }
    }
    if (clear > bestClear) {
      bestClear = clear;
      bestAngle = a;
    }
  }
  return bestAngle;
}

/** 탐침용: (px,py)가 벽 밖이거나 장애물에 닿는가(머리 반경 기준). */
function blockedAt(obstacles: readonly Obstacle[], px: number, py: number): boolean {
  if (px < C.wallMargin || px > C.screenWidth - C.wallMargin || py < C.wallMargin || py > C.screenHeight - C.wallMargin) {
    return true;
  }
  for (const ob of obstacles) {
    if (obstacleBlocks(ob, px, py, HEAD_R, SEG_HALF)) return true;
  }
  return false;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
