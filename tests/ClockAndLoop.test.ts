import { afterEach, describe, expect, it, vi } from "vitest";
import { selectBestClockAnchor, serverNowFromAnchor, serverTimeToPerformance } from "../packages/core/src/ClockSync";
import { GameLoop } from "../packages/core/src/GameLoop";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("시각 동기화", () => {
  it("RTT가 가장 작은 표본을 기준점으로 선택한다", () => {
    const anchor = selectBestClockAnchor([
      { rtt: 80, receivedAt: 1000, serverTimeAtReceipt: 5000 },
      { rtt: 12, receivedAt: 1100, serverTimeAtReceipt: 5110 },
      { rtt: 40, receivedAt: 1200, serverTimeAtReceipt: 5220 },
    ]);
    expect(anchor).toEqual({ serverTime: 5110, performanceTime: 1100 });
    expect(serverNowFromAnchor(anchor, 1250)).toBe(5260);
    expect(serverTimeToPerformance(anchor, 5410)).toBe(1400);
  });
});

describe("GameLoop 예약 epoch", () => {
  it("늦게 실행돼도 예약 시각부터 경과한 tick을 따라잡는다", () => {
    let now = 1000;
    let frame: FrameRequestCallback | undefined;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("setInterval", vi.fn(() => 1));
    vi.stubGlobal("clearInterval", vi.fn());

    const updates: number[] = [];
    const loop = new GameLoop((tick) => updates.push(tick), () => undefined);
    loop.resetTick(1000);
    loop.start();
    now = 1101;
    frame?.(now);
    loop.stop();

    expect(updates).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
