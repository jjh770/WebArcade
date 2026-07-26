/* 커브 피버 결정론 회귀. 죽림고수 Determinism.test.ts와 같은 방식 —
   내부 필드가 아니라 렌더 출력(꼬리 선분)을 캡처해 비교한다.

   핵심 불변식: 같은 시드 + 같은 입력이면 어느 클라에서 돌려도 꼬리가
   픽셀 단위로 같아야 한다. 이게 깨지면 충돌 판정이 클라마다 어긋나
   "내 화면엔 안 부딪혔는데 죽었다"가 된다. */
import { describe, expect, it } from "vitest";
import type { IRenderer, InputState } from "@arcade/shared";
import { CurveGame } from "../packages/games/curve/src/CurveGame";

const IDLE: InputState = { up: false, down: false, left: false, right: false };
const TURN_RIGHT: InputState = { up: false, down: false, left: false, right: true };

const MY_COLOR = "#e63946"; // CurveGame이 자기 꼬리를 그리는 색

class TrailCapture implements IRenderer {
  readonly width = 800;
  readonly height = 800;
  readonly segments: number[][] = [];
  clear(): void {}
  circle(): void {}
  rect(): void {}
  text(): void {}
  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
    if (color === MY_COLOR) this.segments.push([x1, y1, x2, y2, width]);
  }
}

function simulate(seed: number, input: InputState, ticks: number): { segments: number[][]; dead: boolean } {
  const game = new CurveGame();
  game.init(seed);
  for (let tick = 1; tick <= ticks; tick++) game.update(tick, input);
  const capture = new TrailCapture();
  game.render(capture, 0);
  return { segments: capture.segments, dead: game.isPlayerDead() };
}

describe("커브 피버 결정론", () => {
  it("같은 시드+입력이면 꼬리가 완전히 동일하다", () => {
    const a = simulate(12345, TURN_RIGHT, 120);
    const b = simulate(12345, TURN_RIGHT, 120);
    expect(a.segments.length).toBeGreaterThan(0);
    expect(b.segments).toEqual(a.segments);
  });

  it("같은 인스턴스를 다시 init하면 같은 꼬리를 재생한다", () => {
    const game = new CurveGame();
    const capture = (): number[][] => {
      game.init(555);
      for (let t = 1; t <= 100; t++) game.update(t, TURN_RIGHT);
      const c = new TrailCapture();
      game.render(c, 0);
      return c.segments;
    };
    expect(capture()).toEqual(capture());
  });

  it("다른 시드는 다른 시작 위치를 준다", () => {
    const a = new CurveGame();
    const b = new CurveGame();
    a.init(1);
    b.init(2);
    expect(a.getPosition()).not.toEqual(b.getPosition());
  });

  it("직진 시 꼬리 점 간격이 speed(2px)와 일치한다 — 곡선이 매끄럽다는 근거", () => {
    // 매 tick 정확히 speed만큼 나아가고 점 하나를 남긴다. 간격이 커지거나
    // 들쭉날쭉하면(이중 push, 속도 버그) 선이 끊기거나 충돌 판정에 틈이 생긴다.
    const { segments } = simulate(999, IDLE, 20);
    expect(segments.length).toBeGreaterThan(10);
    for (const [x1, y1, x2, y2] of segments) {
      const gap = Math.hypot(x2! - x1!, y2! - y1!);
      expect(gap).toBeCloseTo(2, 5); // speed = 2px
    }
  });
});

describe("커브 피버 충돌", () => {
  it("벽을 향해 직진하면 언젠가 죽는다", () => {
    expect(simulate(777, IDLE, 500).dead).toBe(true);
  });

  it("계속 한 방향으로 꺾으면 원을 그려 자기 꼬리를 밟는다", () => {
    // turnRate 0.05 → 한 바퀴 ≈ 126 tick. 그 뒤 출발점 부근으로 돌아와
    // 면제 구간 밖 꼬리에 닿아야 한다.
    expect(simulate(42, TURN_RIGHT, 200).dead).toBe(true);
  });

  it("잠깐 직진하는 동안은 자기 꼬리에 즉사하지 않는다(면제 구간)", () => {
    expect(simulate(999, IDLE, 30).dead).toBe(false);
  });

  it("죽은 뒤 update는 위치도 점수도 바꾸지 않는다", () => {
    const game = new CurveGame();
    game.init(777);
    for (let t = 1; t <= 500; t++) game.update(t, IDLE); // 벽에 박혀 죽는다
    expect(game.isPlayerDead()).toBe(true);
    const pos = game.getPosition();
    const score = game.getScore();
    for (let t = 501; t <= 520; t++) game.update(t, TURN_RIGHT);
    expect(game.getPosition()).toEqual(pos);
    expect(game.getScore()).toBe(score);
  });
});
