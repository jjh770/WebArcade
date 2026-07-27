/* ============================================================
   CurveGame — 커브 피버 (IGame 구현)
   ------------------------------------------------------------
   내 선 하나. 좌/우 회전, 꼬리 기록, 자기 꼬리·벽·장애물 충돌.
   남의 꼬리와의 충돌(관전 재구성)은 다음 단계에서 붙는다.

   장애물은 선분 벽 + 꽉 찬 원 기둥 두 종류(obstacles.ts). 전부 시드에서만
   파생되는 공통 월드라, 스폰보다 먼저 뽑아 모든 클라에서 같은 판이 나온다.

   결정론 불변식: update는 tick + input에서만 파생된다. Math.random 없음.
   같은 시드 + 같은 입력이면 어느 클라에서 돌려도 꼬리가 픽셀 단위로 같다.
   ============================================================ */

import type { IGame, IRenderer, InputState, PeerState, SpectateTarget } from "@arcade/shared";
import { SeededRNG } from "@arcade/core";
import { curveConfig as C } from "./config";
import { drawObstacle, obstacleBlocks, obstacleClearance, type Obstacle } from "./obstacles";

const TAU = Math.PI * 2;

const ARENA_FLOOR = "#1e2230";
const WALL_COLOR = "#457b9d";
const MY_COLOR = "#e63946";
const HEAD_COLOR = "#ffd166";

/** 플레이어 머리 반경 = 선 절반 두께. 충돌·탐침의 pad로 쓴다. */
const HEAD_R = C.lineWidth / 2;
/** 선분 장애물의 반 두께. */
const SEG_HALF = C.obstacleWidth / 2;

export class CurveGame implements IGame {
  // 머리(현재 위치)와 진행 방향.
  private x = 0;
  private y = 0;
  private angle = 0;

  // 꼬리 좌표. 매 tick 머리 위치를 한 점씩 쌓는다.
  // 병렬 배열로 두어 긴 라운드에서도 점당 객체 할당이 없게 한다.
  private trailX: number[] = [];
  private trailY: number[] = [];

  // 장애물(선분 벽 + 원 기둥). 시드에서만 파생 → 모두가 같은 판.
  private obstacles: Obstacle[] = [];

  private dead = false;
  private survivalTicks = 0;

  init(seed: number): void {
    const rng = new SeededRNG(seed);
    // ⚠️ 순서가 중요하다: 장애물을 **먼저** 뽑는다. 장애물은 플레이어와 무관한
    //    공통 월드라, 스폰(플레이어별로 달라질 수 있음)보다 앞서 정해져야
    //    모든 클라에서 같은 판이 나온다. (멀티에서 스폰이 갈려도 판은 안 갈린다)
    this.obstacles = this.generateObstacles(rng);
    const spawn = this.pickSafeSpawn(rng);
    this.x = spawn.x;
    this.y = spawn.y;
    // 랜덤 방향이면 벽·장애물을 정면으로 향해 즉사할 수 있다. 주변을 훑어
    // "가장 트인 쪽"으로 출발시킨다.
    this.angle = this.chooseOpenHeading(rng, spawn.x, spawn.y);

    this.trailX = [this.x];
    this.trailY = [this.y];
    this.dead = false;
    this.survivalTicks = 0;
  }

  /** 장애물을 시드에서 뽑는다. 벽붙은 선분 → 떠 있는 선분 → 원 기둥 순.
   *  ⚠️ 이 고정 순서를 지켜야 클라마다 같은 판이 나온다. */
  private generateObstacles(rng: SeededRNG): Obstacle[] {
    const { count, wallAttachedCount, minLength, maxLength, edgeMargin, circleCount, polygonCount } = C.obstacles;
    const out: Obstacle[] = [];
    const attached = Math.min(wallAttachedCount, count);
    // 처음 4개는 네 변(0=위 1=오른쪽 2=아래 3=왼쪽)에 하나씩 배정해 모든 변이
    // 최소 하나는 갖게 한다(둘레 어디로도 그냥 돌 수 없게). 나머지는 랜덤 변.
    for (let i = 0; i < attached; i++) {
      const wall = i < 4 ? i : rng.int(4);
      out.push(this.wallAttachedSegment(rng, wall));
    }
    for (let i = attached; i < count; i++) out.push(this.floatingSegment(rng, minLength, maxLength, edgeMargin));
    for (let i = 0; i < circleCount; i++) out.push(this.circlePillar(rng));
    for (let i = 0; i < polygonCount; i++) out.push(this.polygonRing(rng));
    return out;
  }

  /** 바깥 벽 한 곳(wall: 0=위 1=오른쪽 2=아래 3=왼쪽)에 한쪽 끝을 붙이고
   *  안쪽으로 뻗는 선분(벽에서 자란 돌기). */
  private wallAttachedSegment(rng: SeededRNG, wall: number): Obstacle {
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
  private floatingSegment(rng: SeededRNG, minLength: number, maxLength: number, edgeMargin: number): Obstacle {
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
  private circlePillar(rng: SeededRNG): Obstacle {
    const { circleMinRadius, circleMaxRadius } = C.obstacles;
    const r = rng.range(circleMinRadius, circleMaxRadius);
    const cx = rng.range(C.wallMargin + r, C.screenWidth - C.wallMargin - r);
    const cy = rng.range(C.wallMargin + r, C.screenHeight - C.wallMargin - r);
    return { kind: "circle", cx, cy, r };
  }

  /** 속 빈 다각형(정다각형 + 전체 회전). 윤곽선만 벽이라 안에 들어갔다 나올 수 있다. */
  private polygonRing(rng: SeededRNG): Obstacle {
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
  private pickSafeSpawn(rng: SeededRNG): { x: number; y: number } {
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
      for (const ob of this.obstacles) {
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

  /** 시작 위치에서 사방을 훑어 "가장 트인 방향"을 고른다. 각 후보 방향으로 짧은
   *  탐침을 쏘아 벽·장애물에 막힐 때까지의 거리를 재고, 그게 가장 큰 방향을 쓴다.
   *  rng는 후보 각도의 시작 오프셋 하나만 소비한다(판마다 방향이 달라지게). */
  private chooseOpenHeading(rng: SeededRNG, x: number, y: number): number {
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
        if (this.blockedAt(x + cos * d, y + sin * d)) {
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
  private blockedAt(px: number, py: number): boolean {
    if (px < C.wallMargin || px > C.screenWidth - C.wallMargin || py < C.wallMargin || py > C.screenHeight - C.wallMargin) {
      return true;
    }
    for (const ob of this.obstacles) {
      if (obstacleBlocks(ob, px, py, HEAD_R, SEG_HALF)) return true;
    }
    return false;
  }

  update(tick: number, input: InputState): void {
    if (this.dead) return; // 죽으면 내 선은 멈춘다(꼬리는 그대로 남아 장애물).

    // 좌/우 입력이 있을 때만 방향을 튼다. 둘 다거나 없으면 직진.
    if (input.left && !input.right) this.angle -= C.turnRate;
    else if (input.right && !input.left) this.angle += C.turnRate;

    this.x += Math.cos(this.angle) * C.speed;
    this.y += Math.sin(this.angle) * C.speed;
    this.trailX.push(this.x);
    this.trailY.push(this.y);

    if (this.hitWall() || this.hitOwnTrail() || this.hitObstacle()) {
      this.dead = true;
      return;
    }
    this.survivalTicks = tick;
  }

  private hitWall(): boolean {
    return (
      this.x - HEAD_R < C.wallMargin ||
      this.x + HEAD_R > C.screenWidth - C.wallMargin ||
      this.y - HEAD_R < C.wallMargin ||
      this.y + HEAD_R > C.screenHeight - C.wallMargin
    );
  }

  /** 머리가 자기 꼬리에 닿았나. 머리 바로 뒤 selfImmuneTrailPoints개는 면제한다
   *  — 머리에 가장 가까운 꼬리는 원래 붙어 있어, 면제 없이는 매 tick 즉사한다. */
  private hitOwnTrail(): boolean {
    const threshold = C.lineWidth * C.lineWidth; // 제곱 비교(sqrt 회피)
    const last = this.trailX.length - 1 - C.selfImmuneTrailPoints;
    for (let i = 0; i <= last; i++) {
      const dx = this.x - this.trailX[i]!;
      const dy = this.y - this.trailY[i]!;
      if (dx * dx + dy * dy < threshold) return true;
    }
    return false;
  }

  /** 머리가 장애물(선분·원)에 닿았나. */
  private hitObstacle(): boolean {
    for (const ob of this.obstacles) {
      if (obstacleBlocks(ob, this.x, this.y, HEAD_R, SEG_HALF)) return true;
    }
    return false;
  }

  render(r: IRenderer, _alpha: number): void {
    this.drawArena(r);
    this.drawTrail(r, this.trailX, this.trailY, MY_COLOR);
    if (!this.dead) r.circle(this.x, this.y, C.lineWidth, HEAD_COLOR);
  }

  private drawArena(r: IRenderer): void {
    r.clear();
    // 바깥은 벽 색(죽음의 경계), 안쪽은 바닥. 경계선이 곧 벽이다.
    r.rect(0, 0, C.screenWidth, C.screenHeight, WALL_COLOR);
    r.rect(
      C.wallMargin,
      C.wallMargin,
      C.screenWidth - C.wallMargin * 2,
      C.screenHeight - C.wallMargin * 2,
      ARENA_FLOOR,
    );
    // 장애물. 바깥 벽과 같은 색이라 "부딪히면 죽는 벽"으로 읽힌다.
    for (const ob of this.obstacles) drawObstacle(r, ob, WALL_COLOR, C.obstacleWidth);
  }

  private drawTrail(r: IRenderer, xs: readonly number[], ys: readonly number[], color: string): void {
    for (let i = 1; i < xs.length; i++) {
      r.line(xs[i - 1]!, ys[i - 1]!, xs[i]!, ys[i]!, color, C.lineWidth);
    }
  }

  isPlayerDead(): boolean {
    return this.dead;
  }

  getPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  getScore(): number {
    return this.survivalTicks;
  }

  // --- 관전 계약: 다음 단계에서 남의 꼬리 이력으로 채운다. 지금은 no-op. ---
  syncPeers(_peers: readonly PeerState[]): void {
    /* 위치 이력을 모아 남의 꼬리를 재구성한다. */
  }

  renderSpectator(r: IRenderer, _target: SpectateTarget): void {
    // 아직은 경기장 + 장애물만 그린다. 장애물은 시드 공유라 이 로컬 인스턴스
    // 것이 방 전체와 같다(남의 꼬리 재구성은 다음 단계).
    this.drawArena(r);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
