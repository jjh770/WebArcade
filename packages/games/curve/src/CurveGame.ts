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

  private dead = false;
  private survivalTicks = 0;

  init(seed: number): void {
    const rng = new SeededRNG(seed);
    // 벽에서 spawnInset만큼 안쪽 영역에서 시작 위치를 뽑는다.
    const minX = C.wallMargin + C.spawnInset;
    const maxX = C.screenWidth - C.wallMargin - C.spawnInset;
    const minY = C.wallMargin + C.spawnInset;
    const maxY = C.screenHeight - C.wallMargin - C.spawnInset;
    this.x = rng.range(minX, maxX);
    this.y = rng.range(minY, maxY);
    this.angle = rng.next() * TAU;

    this.trailX = [this.x];
    this.trailY = [this.y];
    this.dead = false;
    this.survivalTicks = 0;
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

    if (this.hitWall() || this.hitOwnTrail()) {
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
    // 3단계 전까지는 최소한 경기장만 그린다(빈 화면 방지).
    this.drawArena(r);
  }
}
