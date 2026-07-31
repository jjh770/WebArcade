/* ============================================================
   배경 광원 추종 — 순수 계산부
   ------------------------------------------------------------
   장식이라 게임 결과와 무관하지만, "반드시 멈춘다"는 성질만은 확인해 둔다.
   안 멈추면 유휴 상태에서 rAF가 영원히 돌아 배터리를 먹는다(UI_MOTION.md 성능).
   ============================================================ */

import { describe, it, expect } from "vitest";
import { followStep, type Point } from "../packages/app/src/bgDecor";

/** 도착할 때까지 돌린 프레임 수와 최종 위치. */
function runToRest(from: Point, to: Point, maxFrames = 10_000): { frames: number; at: Point } {
  let current = from;
  for (let frames = 1; frames <= maxFrames; frames++) {
    const { next, done } = followStep(current, to);
    current = next;
    if (done) return { frames, at: current };
  }
  throw new Error("멈추지 않았다");
}

describe("배경 광원 추종", () => {
  it("목표에 정확히 도착하고 멈춘다", () => {
    const { at } = runToRest({ x: 0, y: 0 }, { x: 1200, y: 800 });
    expect(at).toEqual({ x: 1200, y: 800 });
  });

  it("화면을 가로지르는 거리도 1초 남짓에 수렴한다", () => {
    // 60fps 기준. 너무 빠르면 커서에 붙어 싸구려로, 너무 느리면 굼떠 보인다.
    const { frames } = runToRest({ x: 0, y: 0 }, { x: 1920, y: 1080 });
    expect(frames).toBeGreaterThan(30); // 0.5초보다는 느긋하게 따라온다
    expect(frames).toBeLessThan(180); // 3초 안에는 도착한다
  });

  it("이미 목표에 있으면 한 프레임 만에 끝난다", () => {
    const { done } = followStep({ x: 400, y: 300 }, { x: 400, y: 300 });
    expect(done).toBe(true);
  });

  it("가까워질수록 느려진다 — 등속이 아니라 감속으로 따라붙는다", () => {
    const target = { x: 1000, y: 0 };
    const first = followStep({ x: 0, y: 0 }, target).next.x;
    const later = followStep({ x: 900, y: 0 }, target).next.x - 900;
    expect(first).toBeGreaterThan(later * 5);
  });

  it("목표가 바뀌면 새 목표를 향해 간다 — 옛 목표를 먼저 들르지 않는다", () => {
    const midway = followStep({ x: 0, y: 0 }, { x: 1000, y: 0 }).next;
    const turned = followStep(midway, { x: -1000, y: 0 }).next;
    expect(turned.x).toBeLessThan(midway.x);
  });
});
