/* 커브 피버 결정론 회귀. 죽림고수 Determinism.test.ts와 같은 방식 —
   내부 필드가 아니라 렌더 출력(꼬리 선분)을 캡처해 비교한다.

   핵심 불변식: 같은 시드 + 같은 입력이면 어느 클라에서 돌려도 꼬리가
   픽셀 단위로 같아야 한다. 이게 깨지면 충돌 판정이 클라마다 어긋나
   "내 화면엔 안 부딪혔는데 죽었다"가 된다. */
import { describe, expect, it } from "vitest";
import type { IRenderer, InputState } from "@arcade/shared";
import { CurveGame, nearMissGain } from "../packages/games/curve/src/CurveGame";
import { curveConfig } from "../packages/games/curve/src/config";
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

/** text() 호출만 모으는 렌더러(HUD·사망문구·이름표 검증용). */
class TextCapture implements IRenderer {
  readonly width = 800;
  readonly height = 800;
  readonly texts: string[] = [];
  clear(): void {}
  circle(): void {}
  rect(): void {}
  line(): void {}
  text(s: string): void {
    this.texts.push(s);
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

describe("관전용 남 꼬리 재구성 (C-1 — 판정엔 안 쓰는 시각 근사)", () => {
  const PEER0 = "#f4a261"; // PEER_COLORS[0] — 첫 피어 꼬리 색
  const PEER1 = "#2a9d8f"; // PEER_COLORS[1] — 둘째 피어

  /** 스냅샷 위치들을 순서대로 syncPeers에 흘려 넣는다(매 스냅샷 = 점 하나). */
  function feed(game: CurveGame, id: string, pts: readonly [number, number][]): void {
    for (const [x, y] of pts) game.syncPeers([{ id, x, y }]);
  }

  it("흘려 넣은 위치들이 그 순서대로 꼬리 폴리라인이 된다", () => {
    const game = new CurveGame();
    game.init(1);
    feed(game, "p1", [[100, 100], [110, 105], [122, 118]]);

    const cap = new LineCapture(PEER0);
    game.renderSpectator(cap, { id: "p1", x: 122, y: 118, label: "고수" });
    // 점 3개 → 선분 2개, 이어지는 좌표가 맞아야 한다.
    expect(cap.segments.map((s) => s.slice(0, 4))).toEqual([
      [100, 100, 110, 105],
      [110, 105, 122, 118],
    ]);
  });

  it("위치 변화 없이 다시 불려도 점을 중복으로 쌓지 않는다", () => {
    // 사망 통지(markPeerDead)처럼 위치 그대로 syncPeers가 또 불릴 수 있다.
    const game = new CurveGame();
    game.init(1);
    feed(game, "p1", [[200, 200], [200, 200], [210, 205], [210, 205]]);

    const cap = new LineCapture(PEER0);
    game.renderSpectator(cap, { id: "p1", x: 210, y: 205, label: "고수" });
    expect(cap.segments.map((s) => s.slice(0, 4))).toEqual([[200, 200, 210, 205]]); // 선분 1개뿐
  });

  it("여러 피어는 서로 다른 색으로, 입장 순서대로 배정된다", () => {
    const game = new CurveGame();
    game.init(1);
    game.syncPeers([{ id: "a", x: 10, y: 10 }, { id: "b", x: 20, y: 20 }]);
    game.syncPeers([{ id: "a", x: 12, y: 10 }, { id: "b", x: 22, y: 20 }]);

    const target = { id: "a", x: 12, y: 10, label: "A" };
    const capA = new LineCapture(PEER0);
    const capB = new LineCapture(PEER1);
    game.renderSpectator(capA, target);
    game.renderSpectator(capB, target);
    expect(capA.segments.map((s) => s.slice(0, 4))).toEqual([[10, 10, 12, 10]]); // a = 첫 색
    expect(capB.segments.map((s) => s.slice(0, 4))).toEqual([[20, 20, 22, 20]]); // b = 둘째 색
  });

  it("각 피어 머리에 닉네임 이름표를 붙인다 (A-3)", () => {
    const game = new CurveGame();
    game.init(1);
    game.syncPeers([{ id: "p1", x: 100, y: 100, label: "고수" }]);
    game.syncPeers([{ id: "p1", x: 120, y: 110, label: "고수" }]);

    const cap = new TextCapture();
    game.renderSpectator(cap, { id: "p1", x: 120, y: 110, label: "고수" });
    expect(cap.texts).toContain("고수"); // 이름표
  });

  it("새 라운드(init)면 지난 판 남 꼬리를 비운다", () => {
    const game = new CurveGame();
    game.init(1);
    feed(game, "p1", [[100, 100], [110, 105]]);
    game.init(2); // 재시작

    const cap = new LineCapture(PEER0);
    game.renderSpectator(cap, { id: "p1", x: 0, y: 0, label: "고수" });
    expect(cap.segments).toHaveLength(0);
  });
});

describe("멀티 스폰 분리 (C-2 — 플레이어별 다른 시작점)", () => {
  const spawnAt = (seed: number, index: number, count: number): { x: number; y: number } => {
    const g = new CurveGame();
    g.init(seed, { index, count });
    return g.getPosition();
  };

  it("같은 판에서 순번마다 다른 스폰을 준다(시작점이 겹치지 않는다)", () => {
    for (const seed of [1, 42, 999, 2024]) {
      const pts = [0, 1, 2, 3].map((i) => spawnAt(seed, i, 4));
      for (let a = 0; a < pts.length; a++) {
        for (let b = a + 1; b < pts.length; b++) {
          expect(Math.hypot(pts[a]!.x - pts[b]!.x, pts[a]!.y - pts[b]!.y)).toBeGreaterThan(1);
        }
      }
    }
  });

  it("같은 순번·시드·인원이면 어느 클라에서든 같은 스폰이다(결정론)", () => {
    expect(spawnAt(2024, 2, 4)).toEqual(spawnAt(2024, 2, 4));
    expect(spawnAt(7, 0, 8)).toEqual(spawnAt(7, 0, 8));
  });

  it("각 순번의 스폰은 안전하다 — 직진해도 한동안 산다", () => {
    for (const seed of [1, 42, 999]) {
      for (let i = 0; i < 4; i++) {
        const g = new CurveGame();
        g.init(seed, { index: i, count: 4 });
        for (let t = 1; t <= 20 && !g.isPlayerDead(); t++) g.update(t, IDLE);
        expect(g.isPlayerDead()).toBe(false);
      }
    }
  });

  it("솔로(self 없음)는 count 1과 동일 — 기존 스폰 동작 그대로", () => {
    const solo = new CurveGame();
    solo.init(555);
    const one = new CurveGame();
    one.init(555, { index: 0, count: 1 });
    expect(one.getPosition()).toEqual(solo.getPosition());
  });
});

describe("커브 사망 피드백·HUD (A-2, 시간·게이지는 DOM으로 이동)", () => {
  it("생존 시간은 getScore로 노출되고, 캔버스에는 더 이상 타이머를 그리지 않는다", () => {
    const game = new CurveGame();
    game.init(999);
    for (let t = 1; t <= 90; t++) game.update(t, IDLE);
    expect(game.getScore()).toBeGreaterThan(0); // HUD(DOM)가 이 값을 표시한다
    const cap = new TextCapture();
    game.render(cap, 0);
    // 타이머는 캔버스 밖 DOM 헤더로 옮겼으니 render엔 "X.Xs" 단독 텍스트가 없다.
    expect(cap.texts.some((s) => /^\d+\.\d+s$/.test(s))).toBe(false);
  });

  it("죽으면 중앙에 '사망 — 생존 X초' 문구를 그린다(살아있을 땐 없다)", () => {
    const game = new CurveGame();
    game.init(777);
    const alive = new TextCapture();
    game.render(alive, 0);
    expect(alive.texts.some((s) => s.startsWith("사망"))).toBe(false); // 시작 직후 생존

    for (let t = 1; t <= 500; t++) game.update(t, IDLE); // 벽에 박혀 죽는다
    expect(game.isPlayerDead()).toBe(true);
    const dead = new TextCapture();
    game.render(dead, 0);
    expect(dead.texts.some((s) => s.startsWith("사망 — 생존"))).toBe(true);
  });
});

describe("스릴 게이지 (1단계 — 니어 미스로 로컬 충전)", () => {
  it("nearMissGain: 밴드 밖·충돌은 0, 경계에 붙을수록 최대에 가깝다", () => {
    const band = 14;
    const g = 0.02;
    expect(nearMissGain(-1, band, g)).toBe(0); // 충돌(음수)
    expect(nearMissGain(0, band, g)).toBe(0); // 경계선 = 아직 충돌 취급
    expect(nearMissGain(20, band, g)).toBe(0); // 밴드 밖
    expect(nearMissGain(0.001, band, g)).toBeCloseTo(g, 3); // 거의 붙음 → 최대
    expect(nearMissGain(7, band, g)).toBeCloseTo(g / 2, 5); // 중간 → 절반
    // 가까울수록 크다(단조 감소)
    expect(nearMissGain(3, band, g)).toBeGreaterThan(nearMissGain(10, band, g));
  });

  it("게이지는 항상 0~1 미만으로 유지된다(꽉 차면 리셋 — 절대 갇히지 않는다)", () => {
    for (const seed of [1, 42, 999, 2024, 7, 55555]) {
      const game = new CurveGame();
      game.init(seed);
      for (let t = 1; t <= 400; t++) {
        game.update(t, TURN_RIGHT); // 돌면서 벽·꼬리·장애물을 스치게 된다
        const gauge = game.getGauge();
        expect(gauge).toBeGreaterThanOrEqual(0);
        expect(gauge).toBeLessThan(1); // 1에 닿는 순간 리셋되므로 항상 1 미만
      }
    }
  });

  it("스치며 도는 판에서는 게이지가 실제로 찬다(니어 미스가 일어난다)", () => {
    // 여러 시드 중 하나라도 도는 동안 게이지가 오르면 기능이 살아있는 것.
    let anyCharge = false;
    for (const seed of [1, 42, 999, 2024, 7, 55555, 31337, 8888]) {
      const game = new CurveGame();
      game.init(seed);
      for (let t = 1; t <= 300 && !game.isPlayerDead(); t++) {
        game.update(t, TURN_RIGHT);
        if (game.getGauge() > 0) {
          anyCharge = true;
          break;
        }
      }
      if (anyCharge) break;
    }
    expect(anyCharge).toBe(true);
  });

  it("새 라운드(init)면 게이지가 0으로 리셋된다", () => {
    const game = new CurveGame();
    game.init(42);
    for (let t = 1; t <= 200 && !game.isPlayerDead(); t++) game.update(t, TURN_RIGHT);
    game.init(43);
    expect(game.getGauge()).toBe(0);
  });

  it("오래 직진만 하면(마지막 회전 후 유예 초과) 게이지가 더는 안 찬다 (벽타기 무한충전 방지)", () => {
    const GRACE = curveConfig.nearMiss.turnGraceTicks;
    for (const seed of [1, 42, 999, 2024]) {
      const game = new CurveGame();
      game.init(seed);
      // 잠깐 꺾어 유예 시계를 리셋(살아있는 동안) → 그 뒤 직진만.
      let tick = 1;
      for (; tick <= 30 && !game.isPlayerDead(); tick++) game.update(tick, TURN_RIGHT);
      // 유예가 지날 때까지 직진.
      for (let k = 0; k <= GRACE && !game.isPlayerDead(); k++, tick++) game.update(tick, IDLE);
      const afterGrace = game.getGauge();
      // 유예 후 직진으로 스치더라도 충전이 멈춰야 한다 — 증가 없음.
      for (let k = 0; k < 150 && !game.isPlayerDead(); k++, tick++) game.update(tick, IDLE);
      expect(game.getGauge()).toBeLessThanOrEqual(afterGrace + 1e-9);
    }
  });
});

const TURN_LEFT: InputState = { up: false, down: false, left: true, right: false };

describe("스릴 게이지 발사 → 상대 방해 (2단계)", () => {
  it("발사 대기가 없으면 consumePendingFire는 null이다", () => {
    const game = new CurveGame();
    game.init(1);
    expect(game.consumePendingFire?.()).toBeNull();
  });

  it("게이지가 꽉 차면 디버프 풀을 한 번 내주고 소비한다", () => {
    // 적극적으로 벽·꼬리를 스치며 위빙(좌우 번갈아)하면 게이지가 꽉 차 발사가 나온다.
    // (단순 회전만으론 잘 안 찬다 — 능동적으로 스치는 플레이만 보상하는 튜닝.)
    const weave = (t: number): InputState => (t % 6 < 3 ? TURN_LEFT : TURN_RIGHT);
    let fired: readonly { kind: string; durationMs: number }[] | null = null;
    for (const seed of [1, 42, 999, 2024, 7, 55555, 31337, 8888]) {
      const game = new CurveGame();
      game.init(seed);
      for (let t = 1; t <= 1200 && !game.isPlayerDead(); t++) {
        game.update(t, weave(t));
        const f = game.consumePendingFire?.() ?? null;
        if (f) { fired = f; break; }
      }
      if (fired) break;
    }
    // 앱이 이 풀에서 랜덤으로 하나 뽑아 조준한 상대에게 보낸다.
    expect(fired).toEqual(curveConfig.fire.debuffs);
  });

  it("invert 피격 중엔 좌/우가 뒤집힌다 — 같은 시드에서 LEFT(반전)가 RIGHT(정상)와 같은 궤적", () => {
    for (const seed of [1, 42, 999, 2024]) {
      const inverted = new CurveGame();
      inverted.init(seed);
      inverted.applyEffect?.("invert", 2500); // 150tick 반전
      const normal = new CurveGame();
      normal.init(seed);
      // 반전된 쪽이 LEFT를 넣으면 정상 쪽이 RIGHT를 넣은 것과 같아야 한다(안전 구간만 비교).
      for (let t = 1; t <= 15; t++) {
        inverted.update(t, TURN_LEFT);
        normal.update(t, TURN_RIGHT);
        expect(inverted.getPosition()).toEqual(normal.getPosition());
      }
    }
  });

  it("invert는 지속시간만큼만 간다 — 만료 뒤엔 정상 조작으로 돌아온다", () => {
    // 50ms = 3tick. 3tick 동안은 LEFT가 RIGHT처럼 굴지만, 그 뒤엔 다시 LEFT가 LEFT다.
    const inverted = new CurveGame();
    inverted.init(1);
    inverted.applyEffect?.("invert", 50);
    const normal = new CurveGame();
    normal.init(1);
    for (let t = 1; t <= 3; t++) { inverted.update(t, TURN_LEFT); normal.update(t, TURN_RIGHT); }
    expect(inverted.getPosition()).toEqual(normal.getPosition()); // 반전 구간 = 같음
    for (let t = 4; t <= 6; t++) { inverted.update(t, TURN_LEFT); normal.update(t, TURN_RIGHT); }
    expect(inverted.getPosition()).not.toEqual(normal.getPosition()); // 만료 후 = 서로 반대로 갈림
  });

  it("sluggish 피격 중엔 회전이 둔해진다 — 같은 입력에 덜 꺾여 정상과 궤적이 갈린다", () => {
    for (const seed of [1, 42, 999, 2024]) {
      const slow = new CurveGame();
      slow.init(seed);
      slow.applyEffect?.("sluggish", 3000);
      const normal = new CurveGame();
      normal.init(seed);
      // 같은 TURN_RIGHT를 줘도 sluggish는 회전각이 배수만큼 줄어 궤적이 달라진다.
      for (let t = 1; t <= 15; t++) { slow.update(t, TURN_RIGHT); normal.update(t, TURN_RIGHT); }
      expect(slow.getPosition()).not.toEqual(normal.getPosition());
    }
  });

  it("sluggish는 지속시간이 지나면 정상 회전량으로 돌아온다", () => {
    // 계속 TURN_RIGHT를 주며 위치를 모은다. 둔화 구간의 tick당 회전각은 배수만큼
    // 작고, 만료 뒤엔 다시 커진다. 연속 세 위치로 그 tick의 회전각을 잰다.
    const g = new CurveGame();
    g.init(1);
    g.applyEffect?.("sluggish", 100); // 6tick 둔화
    const pts: { x: number; y: number }[] = [g.getPosition()];
    for (let t = 1; t <= 20; t++) { g.update(t, TURN_RIGHT); pts.push(g.getPosition()); }
    const turnAt = (i: number): number => {
      const ax = pts[i]!.x - pts[i - 1]!.x, ay = pts[i]!.y - pts[i - 1]!.y;
      const bx = pts[i + 1]!.x - pts[i]!.x, by = pts[i + 1]!.y - pts[i]!.y;
      return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    };
    const duringSluggish = turnAt(3); // 둔화 구간
    const afterExpiry = turnAt(15); // 만료 후
    expect(afterExpiry).toBeGreaterThan(duringSluggish * 1.8); // 대략 1/mult(0.4)=2.5배로 회복
    expect(afterExpiry).toBeCloseTo(curveConfig.turnRate, 4); // 정상 회전각과 일치
  });

  it("모르는 효과 kind는 무시한다(옛 클라 안전)", () => {
    const hit = new CurveGame();
    hit.init(7);
    hit.applyEffect?.("nonsense", 2500);
    const plain = new CurveGame();
    plain.init(7);
    for (let t = 1; t <= 15; t++) { hit.update(t, TURN_LEFT); plain.update(t, TURN_LEFT); }
    expect(hit.getPosition()).toEqual(plain.getPosition()); // 아무 변화 없음
  });

  it("새 라운드(init)면 반전 효과가 사라진다", () => {
    const game = new CurveGame();
    game.init(1);
    game.applyEffect?.("invert", 2500);
    game.init(1); // 재시작 — 효과 리셋
    const plain = new CurveGame();
    plain.init(1);
    for (let t = 1; t <= 15; t++) { game.update(t, TURN_LEFT); plain.update(t, TURN_LEFT); }
    expect(game.getPosition()).toEqual(plain.getPosition()); // 반전 없음 = 정상 LEFT
  });

  it("이미 죽었으면 발사에 맞아도 아무 일 없다", () => {
    const game = new CurveGame();
    game.init(777);
    for (let t = 1; t <= 500; t++) game.update(t, IDLE); // 벽에 박혀 죽는다
    expect(game.isPlayerDead()).toBe(true);
    const pos = game.getPosition();
    game.applyEffect?.("invert", 2500);
    for (let t = 501; t <= 520; t++) game.update(t, TURN_LEFT);
    expect(game.getPosition()).toEqual(pos); // 죽은 뒤엔 움직임 없음
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
