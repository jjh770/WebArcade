/* ============================================================
   CurveGame — 커브 피버 (IGame 구현)
   ------------------------------------------------------------
   1단계: 내 선 하나. 좌/우 회전, 꼬리 기록, 자기 꼬리·벽 충돌.
   남의 꼬리와의 충돌(관전 재구성)은 3단계에서 붙는다.

   결정론 불변식: update는 tick + input에서만 파생된다. Math.random 없음
   (spawn 위치만 시드에서 뽑고, 그 뒤로는 난수를 소비하지 않는다).
   같은 시드 + 같은 입력이면 어느 클라에서 돌려도 꼬리가 픽셀 단위로 같다.
   ============================================================ */

import type { IGame, IRenderer, InputState, PeerState, SpectateTarget } from "@arcade/shared";
import { SeededRNG } from "@arcade/core";
import { curveConfig as C } from "./config";

const TAU = Math.PI * 2;

const ARENA_FLOOR = "#1e2230";
const WALL_COLOR = "#457b9d";
const MY_COLOR = "#e63946";
const HEAD_COLOR = "#ffd166";

export class CurveGame implements IGame {
  // 머리(현재 위치)와 진행 방향.
  private x = 0;
  private y = 0;
  private angle = 0;

  // 꼬리 좌표. 매 tick 머리 위치를 한 점씩 쌓는다.
  // 병렬 배열로 두어 긴 라운드에서도 점당 객체 할당이 없게 한다.
  private trailX: number[] = [];
  private trailY: number[] = [];

  // 장애물(선분 벽). 각 항목 [x1, y1, x2, y2]. 시드에서만 파생 → 모두가 같은 판.
  private obstacles: number[][] = [];

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

  /** 선분 벽들을 시드에서 뽑는다. 일부는 바깥 벽에 붙여 안쪽으로 뻗게 하고
   *  (벽 따라 도는 "고속도로"를 끊는다), 나머지는 판 안쪽에 띄운다. */
  private generateObstacles(rng: SeededRNG): number[][] {
    const { count, wallAttachedCount, minLength, maxLength, edgeMargin } = C.obstacles;
    const out: number[][] = [];
    const attached = Math.min(wallAttachedCount, count);
    // ⚠️ 벽붙은 것부터 고정 순서로 뽑아야 클라마다 같은 판이 나온다.
    for (let i = 0; i < attached; i++) out.push(this.wallAttachedSegment(rng));
    for (let i = attached; i < count; i++) out.push(this.floatingSegment(rng, minLength, maxLength, edgeMargin));
    return out;
  }

  /** 바깥 벽 한 곳에 한쪽 끝을 붙이고 안쪽으로 뻗는 선분(벽에서 자란 돌기). */
  private wallAttachedSegment(rng: SeededRNG): number[] {
    const { minLength, maxLength } = C.obstacles;
    const m = C.wallMargin;
    const W = C.screenWidth;
    const H = C.screenHeight;
    const pad = 80; // 벽을 따라 모서리에서 이만큼 떨어진 구간에만 붙인다.
    const wall = rng.int(4); // 0=위 1=오른쪽 2=아래 3=왼쪽
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
    return [bx, by, fx, fy];
  }

  /** 판 안쪽에 떠 있는 선분. 끝점은 바깥 벽에서 edgeMargin만큼 안쪽. */
  private floatingSegment(rng: SeededRNG, minLength: number, maxLength: number, edgeMargin: number): number[] {
    const lo = C.wallMargin + edgeMargin;
    const hiX = C.screenWidth - C.wallMargin - edgeMargin;
    const hiY = C.screenHeight - C.wallMargin - edgeMargin;
    const x1 = rng.range(lo, hiX);
    const y1 = rng.range(lo, hiY);
    const angle = rng.next() * TAU;
    const length = rng.range(minLength, maxLength);
    const x2 = clamp(x1 + Math.cos(angle) * length, lo, hiX);
    const y2 = clamp(y1 + Math.sin(angle) * length, lo, hiY);
    return [x1, y1, x2, y2];
  }

  /** 장애물에서 spawnClearance만큼 떨어진 시작 위치를 뽑는다.
   *  못 찾으면 마지막 후보를 그냥 쓴다(장애물이 많아 꽉 찬 극단적 경우). */
  private pickSafeSpawn(rng: SeededRNG): { x: number; y: number } {
    const minX = C.wallMargin + C.spawnInset;
    const maxX = C.screenWidth - C.wallMargin - C.spawnInset;
    const minY = C.wallMargin + C.spawnInset;
    const maxY = C.screenHeight - C.wallMargin - C.spawnInset;
    const clear2 = C.obstacles.spawnClearance * C.obstacles.spawnClearance;

    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < C.obstacles.maxSpawnAttempts; attempt++) {
      x = rng.range(minX, maxX);
      y = rng.range(minY, maxY);
      let safe = true;
      for (const [ox1, oy1, ox2, oy2] of this.obstacles) {
        if (segPointDist2(x, y, ox1!, oy1!, ox2!, oy2!) < clear2) {
          safe = false;
          break;
        }
      }
      if (safe) break;
    }
    return { x, y };
  }

  /** 시작 위치에서 사방을 훑어 "가장 트인 방향"을 고른다. 각 후보 방향으로 짧은
   *  탐침을 쏘아 벽·장애물에 막힐 때까지의 거리를 재고, 그게 가장 큰 방향을 쓴다.
   *  rng는 후보 각도의 시작 오프셋 하나만 소비한다(판마다 방향이 달라지게). */
  private chooseOpenHeading(rng: SeededRNG, x: number, y: number): number {
    const { headingSamples, spawnClearance } = C.obstacles;
    const offset = rng.next() * TAU;
    const step = 8; // 탐침 간격(px)
    const reach = C.lineWidth / 2 + C.obstacleWidth / 2;
    const reach2 = reach * reach;
    const maxProbe = spawnClearance + 40;

    let bestAngle = offset;
    let bestClear = -1;
    for (let k = 0; k < headingSamples; k++) {
      const a = offset + (k * TAU) / headingSamples;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      let clear = maxProbe;
      for (let d = step; d <= maxProbe; d += step) {
        const px = x + cos * d;
        const py = y + sin * d;
        if (this.blockedAt(px, py, reach2)) {
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

  /** 탐침용: (px,py)가 벽 밖이거나 장애물에 닿는가. */
  private blockedAt(px: number, py: number, reach2: number): boolean {
    if (px < C.wallMargin || px > C.screenWidth - C.wallMargin || py < C.wallMargin || py > C.screenHeight - C.wallMargin) {
      return true;
    }
    for (const [x1, y1, x2, y2] of this.obstacles) {
      if (segPointDist2(px, py, x1!, y1!, x2!, y2!) < reach2) return true;
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
    const r = C.lineWidth / 2;
    return (
      this.x - r < C.wallMargin ||
      this.x + r > C.screenWidth - C.wallMargin ||
      this.y - r < C.wallMargin ||
      this.y + r > C.screenHeight - C.wallMargin
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

  /** 머리가 장애물 선분에 닿았나. 점-선분 거리로 판정. */
  private hitObstacle(): boolean {
    // 머리 반경 + 장애물 반두께. 이 거리 안이면 충돌.
    const reach = C.lineWidth / 2 + C.obstacleWidth / 2;
    const threshold = reach * reach;
    for (const [x1, y1, x2, y2] of this.obstacles) {
      if (segPointDist2(this.x, this.y, x1!, y1!, x2!, y2!) < threshold) return true;
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
    // 장애물 선분. 바깥 벽과 같은 색이라 "부딪히면 죽는 벽"으로 읽힌다.
    for (const [x1, y1, x2, y2] of this.obstacles) {
      r.line(x1!, y1!, x2!, y2!, WALL_COLOR, C.obstacleWidth);
    }
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

  // --- 관전 계약: 3단계에서 남의 꼬리 이력으로 채운다. 지금은 no-op. ---
  syncPeers(_peers: readonly PeerState[]): void {
    /* 3단계: 위치 이력을 모아 남의 꼬리를 재구성한다. */
  }

  renderSpectator(r: IRenderer, _target: SpectateTarget): void {
    // 3단계 전까지는 경기장 + 장애물만 그린다. 장애물은 시드 공유라 이 로컬
    // 인스턴스 것이 방 전체와 같다(남의 꼬리 재구성은 3단계).
    this.drawArena(r);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 점 (px,py)에서 선분 (x1,y1)-(x2,y2)까지 거리의 제곱. sqrt 회피용. */
function segPointDist2(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  // 선분이 사실상 한 점이면 끝점까지 거리.
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}
