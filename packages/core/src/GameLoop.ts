/* ============================================================
   GameLoop — 고정 타임스텝 게임 루프 (실시간 기준)
   ------------------------------------------------------------
   결정론 불변식 #2: 게임 로직은 고정 간격(1/60초)으로만 전진한다.
   tick 시퀀스는 언제나 0,1,2…이고 update가 각 tick마다 정확히 한 번, 순서대로
   호출된다. 바뀌는 건 "언제 호출되느냐"뿐 — 결정론과 무관.

   ⚠️ 왜 실시간(epoch) 기준인가:
   - requestAnimationFrame은 탭이 백그라운드로 가면 멈춘다. rAF에만 의존하면
     자리를 비운 동안 시뮬이 얼어붙어, 멀티에서 남들과 tick이 어긋난다
     (뒤처진 채로 진행해 얻는 AFK 이득). 그래서 tick을 "시작 시각으로부터
     흐른 실시간"에서 파생하고, 놓친 tick은 몰아서 따라잡는다.
   - 백그라운드에서도 setInterval 폴백으로 계속 전진한다(rAF가 멈춰도).
     자리를 비우면 게임이 계속 흘러 (플레이를 안 하면) 불리해진다 — 공정하다.
   ============================================================ */

import { FIXED_STEP_MS } from "@arcade/shared";

/** 한 번에 따라잡는 최대 스텝. 오래 백그라운드에 있다 돌아왔을 때 수천 tick을
 *  한 프레임에 몰아 돌려 UI가 얼어붙는 걸 막는다(여러 프레임에 걸쳐 따라잡음). */
const MAX_CATCHUP_STEPS = 300;
/** rAF가 멈추는 백그라운드에서도 tick이 전진하도록 하는 폴백 주기(ms).
 *  브라우저가 백그라운드 타이머를 ~1초로 늦춰도, 매 호출이 실시간 기준으로
 *  놓친 tick을 한꺼번에 따라잡으므로 시간은 계속 맞는다. */
const FALLBACK_MS = 250;

export class GameLoop {
  private tick = 0;
  private epoch = 0; // performance.now() 기준, tick=0의 시각.
  private running = false;
  private rafId = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onUpdate: (tick: number) => void,
    private readonly onRender: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.rafId = requestAnimationFrame(this.rafLoop);
    // 백그라운드에서 rAF가 멈춰도 계속 전진시키는 폴백(렌더는 rAF만 담당).
    this.intervalId = setInterval(this.intervalTick, FALLBACK_MS);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    if (this.intervalId !== null) clearInterval(this.intervalId);
    this.intervalId = null;
  }

  /** 새 판 시작: tick=0, 실시간 기준점(epoch) 리셋. */
  resetTick(epoch = performance.now()): void {
    this.tick = 0;
    this.epoch = epoch;
  }

  get currentTick(): number {
    return this.tick;
  }

  /** 보일 때: 매 rAF마다 따라잡고 렌더. rAF 체인은 여기서만 이어진다(중복 방지). */
  private rafLoop = (): void => {
    if (!this.running) return;
    this.advance(true);
    this.rafId = requestAnimationFrame(this.rafLoop);
  };

  /** 백그라운드 폴백: tick만 전진(렌더는 안 함 — 안 보이니까). */
  private intervalTick = (): void => {
    if (!this.running) return;
    this.advance(false);
  };

  /** 실시간 기준으로 밀린 tick을 따라잡고, 필요하면 보간 alpha로 렌더. */
  private advance(render: boolean): void {
    const elapsedSteps = (performance.now() - this.epoch) / FIXED_STEP_MS;
    const target = Math.floor(elapsedSteps);

    let behind = target - this.tick;
    if (behind > MAX_CATCHUP_STEPS) behind = MAX_CATCHUP_STEPS;
    for (let i = 0; i < behind; i++) {
      this.onUpdate(this.tick);
      this.tick++;
    }

    if (render) {
      const alpha = Math.max(0, Math.min(1, elapsedSteps - this.tick));
      this.onRender(alpha);
    }
  }
}
