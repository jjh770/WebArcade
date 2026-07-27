/* 커브 피버 결정론 회귀. 죽림고수 Determinism.test.ts와 같은 방식 —
   내부 필드가 아니라 렌더 출력(꼬리 선분)을 캡처해 비교한다.

   핵심 불변식: 같은 시드 + 같은 입력이면 어느 클라에서 돌려도 꼬리가
   픽셀 단위로 같아야 한다. 이게 깨지면 충돌 판정이 클라마다 어긋나
   "내 화면엔 안 부딪혔는데 죽었다"가 된다. */
import { describe, expect, it } from "vitest";
import type { IRenderer, InputState } from "@arcade/shared";
import { CurveGame } from "../packages/games/curve/src/CurveGame";
import { obstacleBlocks, obstacleClearance, type Obstacle } from "../packages/games/curve/src/obstacles";

const IDLE: InputState = { up: false, down: false, left: false, right: false };
const TURN_RIGHT: InputState = { up: false, down: false, left: false, right: true };

const MY_COLOR = "#e63946"; // CurveGame이 자기 꼬리를 그리는 색
const WALL_COLOR = "#457b9d"; // 장애물(선분 벽)을 그리는 색 — 테두리는 rect라 안 잡힘

/** 특정 색의 line()·circle() 호출을 골라 담는 캡처 렌더러.
 *  선분 장애물은 line(WALL_COLOR), 원 기둥은 circle(WALL_COLOR)로 그려진다
 *  (머리는 HEAD_COLOR라 안 잡힘). */
class LineCapture implements IRenderer {
  readonly width = 800;
  readonly height = 800;
  readonly segments: number[][] = [];
  readonly circles: number[][] = [];
  constructor(private readonly want: string) {}
  clear(): void {}
  circle(x: number, y: number, radius: number, color: string): void {
    if (color === this.want) this.circles.push([x, y, radius]);
  }
  rect(): void {}
  text(): void {}
  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
    if (color === this.want) this.segments.push([x1, y1, x2, y2, width]);
  }
}

class TrailCapture extends LineCapture {
  constructor() {
    super(MY_COLOR);
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

describe("커브 피버 장애물 (매판 랜덤, 모두 같은 판)", () => {
  /** init 직후 렌더해서 장애물(선분·원)을 뽑는다. */
  function captureOf(seed: number): { segments: number[][]; circles: number[][] } {
    const game = new CurveGame();
    game.init(seed);
    const cap = new LineCapture(WALL_COLOR);
    game.render(cap, 0);
    return { segments: cap.segments, circles: cap.circles };
  }
  const obstaclesOf = (seed: number): number[][] => captureOf(seed).segments;

  it("같은 시드는 같은 장애물 배치를 준다", () => {
    expect(obstaclesOf(2024)).toEqual(obstaclesOf(2024));
  });

  it("다른 시드는 다른 장애물 배치를 준다", () => {
    expect(obstaclesOf(1)).not.toEqual(obstaclesOf(2));
  });

  it("선분 벽 + 다각형 변이 예상 범위만큼 그려진다", () => {
    // WALL_COLOR line은 선분 9개 + 다각형 2개의 변(각 3~5)이 섞여 잡힌다.
    // 정확한 다각형 변 수는 랜덤이라 범위로 확인한다: 9 + 2*3 ~ 9 + 2*5.
    const n = obstaclesOf(42).length;
    expect(n).toBeGreaterThanOrEqual(9 + 2 * 3);
    expect(n).toBeLessThanOrEqual(9 + 2 * 5);
  });

  it("네 변 모두에 벽붙은 선분이 최소 하나씩 있다(어느 둘레로도 그냥 못 돈다)", () => {
    // 벽에 붙었다 = 끝점이 안쪽 벽 경계(20 또는 780)에 있다. 어느 변인지 분류한다.
    const M = 20; // wallMargin
    const EDGE = 800 - M;
    const near = (v: number, t: number): boolean => Math.abs(v - t) < 0.5;
    for (const seed of [1, 42, 999, 2024, 7, 55555]) {
      const walls = new Set<string>();
      for (const [x1, y1, x2, y2] of obstaclesOf(seed)) {
        for (const [x, y] of [[x1, y1], [x2, y2]] as const) {
          if (near(y!, M)) walls.add("top");
          else if (near(y!, EDGE)) walls.add("bottom");
          else if (near(x!, M)) walls.add("left");
          else if (near(x!, EDGE)) walls.add("right");
        }
      }
      expect([...walls].sort()).toEqual(["bottom", "left", "right", "top"]); // 네 변 모두
    }
  });

  it("꽉 찬 원 기둥이 config 개수만큼 생기고 시드에 결정론적이다", () => {
    expect(captureOf(42).circles).toHaveLength(3); // circleCount
    expect(captureOf(2024).circles).toEqual(captureOf(2024).circles);
    expect(captureOf(1).circles).not.toEqual(captureOf(2).circles);
  });

  it("시작 위치는 선분에도 원 안에도 처박히지 않는다(스폰 안전)", () => {
    for (const seed of [1, 7, 42, 100, 999, 2024, 55555]) {
      const game = new CurveGame();
      game.init(seed);
      const spawn = game.getPosition();
      const { segments, circles } = captureOf(seed);
      for (const [x1, y1, x2, y2] of segments) {
        expect(segDist(spawn.x, spawn.y, x1!, y1!, x2!, y2!)).toBeGreaterThan(80);
      }
      for (const [cx, cy, r] of circles) {
        // 원 표면까지 거리(중심거리 - 반지름)가 넉넉해야 한다 — 원 안이면 음수.
        expect(Math.hypot(spawn.x - cx!, spawn.y - cy!) - r!).toBeGreaterThan(80);
      }
    }
  });

  it("트인 방향으로 출발해 시작하자마자 죽지 않는다", () => {
    // 게임이 너무 빨리 끝나던 문제: 랜덤 방향이 벽·장애물 정면이면 즉사했다.
    // 이제 가장 트인 방향으로 출발하므로, 직진만 해도 한동안은 산다.
    for (const seed of [1, 7, 42, 100, 999, 2024, 55555, 31337]) {
      const game = new CurveGame();
      game.init(seed);
      for (let t = 1; t <= 25 && !game.isPlayerDead(); t++) game.update(t, IDLE);
      expect(game.isPlayerDead()).toBe(false); // 최소 25tick은 생존
    }
  });
});

describe("장애물 판정 (obstacles.ts)", () => {
  const circle: Obstacle = { kind: "circle", cx: 400, cy: 400, r: 30 };
  const segment: Obstacle = { kind: "segment", x1: 100, y1: 100, x2: 300, y2: 100 };

  it("꽉 찬 원: 안·표면 근처면 죽고 멀면 안 죽는다", () => {
    expect(obstacleBlocks(circle, 400, 400, 2, 3)).toBe(true); // 중심(안)
    expect(obstacleBlocks(circle, 428, 400, 2, 3)).toBe(true); // 표면 안쪽(28 < 30)
    expect(obstacleBlocks(circle, 500, 400, 2, 3)).toBe(false); // 멀리
  });

  it("원 여유거리는 안이면 음수, 밖이면 표면까지 거리다", () => {
    expect(obstacleClearance(circle, 400, 400, 3)).toBeCloseTo(-30, 5); // 중심 → -r
    expect(obstacleClearance(circle, 480, 400, 3)).toBeCloseTo(50, 5); // 80 - 30
  });

  it("선분: 선 위/근처면 죽고 벗어나면 안 죽는다", () => {
    expect(obstacleBlocks(segment, 200, 100, 2, 3)).toBe(true); // 선 위
    expect(obstacleBlocks(segment, 200, 108, 2, 3)).toBe(false); // 8px 밖(2+3=5 초과)
  });

  it("다각형은 속이 비었다: 윤곽선에 닿으면 죽고, 안(중심)은 안전하다", () => {
    // 중심 (400,400), 반지름 50 마름모(4각). 변 위는 죽음, 가운데는 통과 가능.
    const diamond: Obstacle = { kind: "polygon", pts: [450, 400, 400, 450, 350, 400, 400, 350] };
    expect(obstacleBlocks(diamond, 425, 425, 2, 3)).toBe(true); // 변의 중점(윤곽선 위)
    expect(obstacleBlocks(diamond, 400, 400, 2, 3)).toBe(false); // 중심(빈 속) → 통과
  });
});

/** 점-선분 거리(테스트용). */
function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

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
