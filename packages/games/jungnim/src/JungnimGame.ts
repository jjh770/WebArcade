/* ============================================================
   JungnimGame — 죽림고수. IGame 구현.
   ------------------------------------------------------------
   이 클래스는 games/ 안에만 존재한다. core는 이걸 모른다.
   core의 GameRunner는 IGame 인터페이스로만 이 게임을 구동한다.

   ⚠️ 개발 순서(DESIGN.md 7절):
   1) 먼저 싱글로 완성 (init/update/render/isPlayerDead/getScore) ← 지금 단계
   2) 멀티까지 전체 플로우 검증
   3) 그 다음에야 두 번째 게임 추가
   ============================================================ */

import type { IGame, IRenderer, InputState } from "@arcade/shared";
import { SeededRNG } from "@arcade/core";
import { jungnimConfig } from "./config";
import { ArrowSpawner } from "./ArrowSpawner";
import { PersonalSpawner } from "./PersonalSpawner";
import { ArrowPool } from "./ArrowPool";

const PLAYER_COLOR = "#e63946";
const ARROW_COLOR = "#1d3557"; // 공통(시드) 화살 — 짙은 남색.
const PERSONAL_COLOR = "#f77f00"; // 개인(조준) 화살 — 주황. "너를 노린다"는 신호.
const HUD_COLOR = "#1d3557";

/** 개인 시드 = 공통 시드에서 파생(별도 스트림 보장). 값 자체는 임의의 큰 홀수 상수.
 *  멀티에서 플레이어별로 다르게 하려면 여기에 playerId 등을 섞으면 된다. */
const PERSONAL_SEED_SALT = 0x9e3779b9;

export class JungnimGame implements IGame {
  // 결정론 불변식: 게임 로직 난수는 반드시 이 시드 RNG에서만.
  // JungnimGame이 소유하고 ArrowSpawner에 주입한다(스폰 위치·변 선택에 소비).
  private rng!: SeededRNG;
  private pool!: ArrowPool;
  private spawner!: ArrowSpawner;
  // 개인(조준) 레이어 — 공통과 분리된 자체 rng를 쓰는 스포너.
  private personalSpawner!: PersonalSpawner;

  private survivalTicks = 0;
  private dead = false;

  // 플레이어 위치 (화면 중앙에서 시작 — init에서 설정)
  private px = 0;
  private py = 0;

  init(seed: number): void {
    this.rng = new SeededRNG(seed);
    this.pool = new ArrowPool(jungnimConfig.poolSize);
    this.spawner = new ArrowSpawner(this.rng, jungnimConfig);
    // 개인 레이어는 공통과 분리된 rng를 소유한다 — 공통 스트림을 절대 건드리지 않음.
    const personalRng = new SeededRNG((seed ^ PERSONAL_SEED_SALT) >>> 0);
    this.personalSpawner = new PersonalSpawner(personalRng, jungnimConfig);
    this.survivalTicks = 0;
    this.dead = false;
    this.centerPlayer();
  }

  update(tick: number, input: InputState): void {
    if (this.dead) return;

    // 플레이어 이동 (고정 스텝이라 속도가 결정론적).
    const s = jungnimConfig.playerSpeed;
    if (input.left) this.px -= s;
    if (input.right) this.px += s;
    if (input.up) this.py -= s;
    if (input.down) this.py += s;

    // 화면 경계 클램프: 원 전체가 화면 안에 있도록 반지름만큼 여백을 둔다.
    const r = jungnimConfig.playerRadius;
    this.px = clamp(this.px, r, jungnimConfig.screenWidth - r);
    this.py = clamp(this.py, r, jungnimConfig.screenHeight - r);

    // 공통 스폰(시드) → 개인 스폰(내 위치 조준) → 이동 → 피격 판정 순서.
    this.spawner.update(tick, this.pool);
    this.personalSpawner.update(tick, this.pool, this.px, this.py);
    this.moveArrows();
    if (this.checkHit()) this.dead = true;

    this.survivalTicks = tick;
  }

  render(r: IRenderer, _alpha: number): void {
    r.clear();

    // 화살: 진행 방향(대각선 포함)을 따라 짧은 선으로 그린다.
    const half = jungnimConfig.arrowLength / 2;
    for (const a of this.pool.items) {
      if (!a.active) continue;
      const len = Math.hypot(a.vx, a.vy) || 1;
      const ux = (a.vx / len) * half;
      const uy = (a.vy / len) * half;
      const color = a.personal ? PERSONAL_COLOR : ARROW_COLOR;
      r.line(a.x - ux, a.y - uy, a.x + ux, a.y + uy, color, 3);
    }

    // 플레이어.
    r.circle(this.px, this.py, jungnimConfig.playerRadius, PLAYER_COLOR);

    // HUD: 생존 시간(초). tick/60이 곧 초 — 고정 스텝이라 실측 시계가 필요 없다.
    r.text(`${(this.survivalTicks / 60).toFixed(1)}s`, 12, 28, HUD_COLOR, 22);
    if (this.dead) {
      // 로컬 사망 표시만. 판 종료·순위·재시작은 앱(멀티)이 관장한다.
      const cx = jungnimConfig.screenWidth / 2;
      const cy = jungnimConfig.screenHeight / 2;
      r.text(`사망 — 생존 ${(this.survivalTicks / 60).toFixed(1)}s`, cx - 90, cy, PLAYER_COLOR, 26);
    }
  }

  isPlayerDead(): boolean {
    return this.dead;
  }

  getScore(): number {
    return this.survivalTicks;
  }

  reset(): void {
    // 같은 인스턴스 재시작. 새 시드로 다시 하려면 init(newSeed)를 부른다.
    this.pool.reset();
    this.spawner.reset();
    this.personalSpawner.reset();
    this.survivalTicks = 0;
    this.dead = false;
    this.centerPlayer();
  }

  private centerPlayer(): void {
    // 원작 죽림고수: 플레이어는 화면 중앙에서 시작.
    this.px = jungnimConfig.screenWidth / 2;
    this.py = jungnimConfig.screenHeight / 2;
  }

  /** 활성 화살을 한 스텝 전진시키고, 화면 밖으로 나간 것은 풀로 반납. */
  private moveArrows(): void {
    const margin = jungnimConfig.arrowLength;
    const w = jungnimConfig.screenWidth;
    const h = jungnimConfig.screenHeight;
    for (const a of this.pool.items) {
      if (!a.active) continue;
      a.x += a.vx;
      a.y += a.vy;
      if (a.x < -margin || a.x > w + margin || a.y < -margin || a.y > h + margin) {
        this.pool.release(a);
      }
    }
  }

  /** 플레이어와 화살의 원-원 충돌. 하나라도 맞으면 true. */
  private checkHit(): boolean {
    const hitR = jungnimConfig.playerRadius + jungnimConfig.arrowRadius;
    const hitR2 = hitR * hitR;
    for (const a of this.pool.items) {
      if (!a.active) continue;
      const dx = this.px - a.x;
      const dy = this.py - a.y;
      if (dx * dx + dy * dy <= hitR2) return true;
    }
    return false;
  }
}

/** 값을 [min, max]로 제한. 순수 함수(결정론과 무관하지만 부수효과 없음 선호). */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
