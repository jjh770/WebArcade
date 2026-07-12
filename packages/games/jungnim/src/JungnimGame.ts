/* ============================================================
   JungnimGame — 죽림고수. IGame 구현.
   ------------------------------------------------------------
   이 클래스는 games/ 안에만 존재한다. core는 이걸 모른다.
   core의 GameRunner는 IGame 인터페이스로만 이 게임을 구동한다.

   ⚠️ 개발 순서(DESIGN.md 7절):
   1) 먼저 싱글로 완성 (init/update/render/isPlayerDead/getScore)
   2) 멀티까지 전체 플로우 검증
   3) 그 다음에야 두 번째 게임 추가
   ============================================================ */

import type { IGame, IRenderer, InputState } from "@arcade/shared";
import { SeededRNG } from "@arcade/core";
import { jungnimConfig } from "./config";
// import { ArrowSpawner } from "./ArrowSpawner";
// import { ArrowPool } from "./ArrowPool";

export class JungnimGame implements IGame {
  private rng!: SeededRNG;
  private survivalTicks = 0;
  private dead = false;

  // 플레이어 위치 (화면 중앙에서 시작 — init에서 설정)
  private px = 0;
  private py = 0;

  init(seed: number): void {
    // 결정론 불변식: 게임 로직 난수는 반드시 이 시드 RNG에서만.
    // (rng 자체는 여기서 위치를 뽑는 데 쓰이지 않지만, ArrowSpawner가 이후 소유한다.)
    this.rng = new SeededRNG(seed);
    // rng는 지금은 소비하지 않는다 — ArrowSpawner가 이후 소유·소비한다.
    // 필드를 보관만 하므로 미사용 경고를 억제(update의 `void difficulty`와 동일 관용구).
    void this.rng;
    this.survivalTicks = 0;
    this.dead = false;
    // 원작 죽림고수: 플레이어는 화면 중앙에서 시작.
    this.px = jungnimConfig.screenWidth / 2;
    this.py = jungnimConfig.screenHeight / 2;
  }

  update(tick: number, input: InputState): void {
    if (this.dead) return;

    // 난이도는 tick의 함수 — Date.now() 금지.
    const difficulty = Math.floor(tick / jungnimConfig.spawn.rampTicks);
    void difficulty; // TODO: 스포너에 전달

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

    // TODO: 화살 스폰/이동, 로컬 피격 판정 → this.dead 세팅
    this.survivalTicks = tick;
  }

  render(r: IRenderer, _alpha: number): void {
    r.clear();
    // TODO: 화살 렌더
    r.circle(this.px, this.py, jungnimConfig.playerRadius, "#e63946");
  }

  isPlayerDead(): boolean {
    return this.dead;
  }

  getScore(): number {
    return this.survivalTicks;
  }

  reset(): void {
    this.survivalTicks = 0;
    this.dead = false;
  }
}

/** 값을 [min, max]로 제한. 순수 함수(결정론과 무관하지만 부수효과 없음 선호). */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
