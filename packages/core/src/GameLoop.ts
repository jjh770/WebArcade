/* ============================================================
   GameLoop — 고정 타임스텝 게임 루프
   ------------------------------------------------------------
   결정론 불변식 #2: 게임 로직은 고정 간격(1/60초)으로만 전진한다.
   requestAnimationFrame은 기기마다 fps가 달라서, 렌더는 자유롭게 하되
   로직 업데이트는 누산기(accumulator)로 고정 스텝만 돌린다.
   → 60fps 기기와 144fps 기기가 같은 시드에서 같은 결과를 낸다.
   ============================================================ */

import { FIXED_STEP_MS } from "@arcade/shared";

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private tick = 0;
  private running = false;
  private rafId = 0;

  constructor(
    private readonly onUpdate: (tick: number) => void,
    private readonly onRender: (alpha: number) => void,
  ) {}

  start(): void {
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** 새 판 시작 시 tick을 0으로. 모든 클라이언트가 동시에 호출해야 함. */
  resetTick(): void {
    this.tick = 0;
    this.accumulator = 0;
    this.lastTime = performance.now();
  }

  getTick(): number {
    return this.tick;
  }

  private frame = (now: number): void => {
    if (!this.running) return;

    let delta = now - this.lastTime;
    this.lastTime = now;

    // death spiral 방지: 탭 전환 등으로 delta가 폭증하면 클램프.
    if (delta > 250) delta = 250;

    this.accumulator += delta;

    // 쌓인 시간만큼 고정 스텝으로 로직 전진.
    while (this.accumulator >= FIXED_STEP_MS) {
      this.onUpdate(this.tick);
      this.tick++;
      this.accumulator -= FIXED_STEP_MS;
    }

    // 렌더는 남은 시간 비율(alpha)로 보간 — 로직엔 영향 없음.
    const alpha = this.accumulator / FIXED_STEP_MS;
    this.onRender(alpha);

    this.rafId = requestAnimationFrame(this.frame);
  };
}
