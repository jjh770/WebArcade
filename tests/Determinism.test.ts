import { describe, expect, it } from "vitest";
import type { IRenderer, InputState } from "@arcade/shared";
import { JungnimGame } from "../packages/games/jungnim/src/JungnimGame";
import { jungnimConfig } from "../packages/games/jungnim/src/config";
import type { ArrowPool } from "../packages/games/jungnim/src/ArrowPool";

const IDLE: InputState = { up: false, down: false, left: false, right: false };
const MOVE_RIGHT: InputState = { up: false, down: false, left: false, right: true };
const MOVE_LEFT: InputState = { up: false, down: false, left: true, right: false };

class CaptureRenderer implements IRenderer {
  readonly width = 800;
  readonly height = 800;
  readonly commonLines: number[][] = [];
  clear(): void {}
  circle(): void {}
  rect(): void {}
  text(): void {}
  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
    if (color === "#1d3557") this.commonLines.push([x1, y1, x2, y2, width]);
  }
}

function simulate(game: JungnimGame, seed: number, input: InputState): number[][] {
  game.init(seed);
  for (let tick = 0; tick < 1200; tick++) game.update(tick, input);
  const renderer = new CaptureRenderer();
  game.render(renderer, 0);
  return renderer.commonLines;
}

describe("죽림고수 결정론", () => {
  it("로컬 입력이 달라도 공통 화살은 동일하다", () => {
    const left = simulate(new JungnimGame(), 123456, IDLE);
    const right = simulate(new JungnimGame(), 123456, MOVE_RIGHT);
    expect(left.length).toBeGreaterThan(0);
    expect(right).toEqual(left);
  });

  it("같은 인스턴스를 같은 시드로 초기화하면 동일한 월드를 재생한다", () => {
    const game = new JungnimGame();
    const first = simulate(game, 777, IDLE);
    const second = simulate(game, 777, IDLE);
    expect(second).toEqual(first);
  });
});

/* ---- 스릴 게이지(스침 횟수) --------------------------------------------------
   게이지가 차려면 화살이 아주 가까이 지나가야 하는데, 그 상황이 자연히 나올 때까지
   시뮬을 돌리면 시드에 휘둘린다. 그래서 공통 풀에 **멈춘 화살**을 원하는 거리에
   직접 놓고 판정만 본다(vx=vy=0이라 스스로 다가와 죽이지 않는다). */

const CENTER = { x: jungnimConfig.screenWidth / 2, y: jungnimConfig.screenHeight / 2 };
/** 죽지는 않고 스치기만 하는 거리 — 피격 반경과 스침 밴드 끝의 중간(튜닝을 따라간다). */
const HIT_RADIUS = jungnimConfig.playerRadius + jungnimConfig.arrowRadius;
const GRAZE_DIST = (HIT_RADIUS + jungnimConfig.nearMiss.grazeRadius) / 2;

/** 공통 풀에 정지한 화살 하나를 (x,y)에 놓는다. */
function placeArrow(game: JungnimGame, x: number, y: number): void {
  const pool = (game as unknown as { commonPool: ArrowPool }).commonPool;
  const arrow = pool.acquire();
  if (!arrow) throw new Error("풀 고갈");
  arrow.x = x;
  arrow.y = y;
  arrow.vx = 0;
  arrow.vy = 0;
}

/** 플레이어(중앙) 주위 distance px 거리에 count발을 고르게 놓는다. */
function ringAroundPlayer(game: JungnimGame, count: number, distance: number): void {
  for (let i = 0; i < count; i++) {
    const angle = ((Math.PI * 2) / count) * i;
    placeArrow(game, CENTER.x + Math.cos(angle) * distance, CENTER.y + Math.sin(angle) * distance);
  }
}

function step(game: JungnimGame, ticks: number, from = 0, input: InputState = IDLE): void {
  for (let tick = from; tick < from + ticks; tick++) game.update(tick, input);
}

describe("죽림고수 스릴 게이지(스침 횟수)", () => {
  it("시작하면 비어 있고 발사도 없다", () => {
    const game = new JungnimGame();
    game.init(42);
    expect(game.getGauge()).toBe(0);
    expect(game.consumePendingFire()).toBeNull();
  });

  it("아주 가까이 스친 화살 1발 = 1회, 같은 화살은 여러 tick 머물러도 다시 안 센다", () => {
    const game = new JungnimGame();
    game.init(42);
    placeArrow(game, CENTER.x + GRAZE_DIST, CENTER.y); // 피격 반경 밖 + 스침 밴드 안
    step(game, 1);
    expect(game.getGauge()).toBeCloseTo(1 / jungnimConfig.nearMiss.needed);
    step(game, 20, 1); // 계속 옆에 붙어 있어도
    expect(game.getGauge()).toBeCloseTo(1 / jungnimConfig.nearMiss.needed);
    expect(game.isPlayerDead()).toBe(false);
  });

  it("밴드 밖으로 지나간 화살은 안 센다", () => {
    const game = new JungnimGame();
    game.init(42);
    placeArrow(game, CENTER.x + jungnimConfig.nearMiss.grazeRadius + 8, CENTER.y);
    step(game, 10);
    expect(game.getGauge()).toBe(0);
  });

  it(`${jungnimConfig.nearMiss.needed}회 채우면 발사하고 게이지가 0으로 돌아간다`, () => {
    const game = new JungnimGame();
    game.init(42);
    ringAroundPlayer(game, jungnimConfig.nearMiss.needed, GRAZE_DIST);
    step(game, 1);
    expect(game.getGauge()).toBe(0);
    expect(game.consumePendingFire()).toEqual(jungnimConfig.fire.debuffs);
    expect(game.consumePendingFire()).toBeNull(); // 한 번만 전송된다
  });

  it("한 발 모자라면 발사하지 않는다", () => {
    const game = new JungnimGame();
    game.init(42);
    ringAroundPlayer(game, jungnimConfig.nearMiss.needed - 1, GRAZE_DIST);
    step(game, 1);
    expect(game.consumePendingFire()).toBeNull();
    expect(game.getGauge()).toBeCloseTo((jungnimConfig.nearMiss.needed - 1) / jungnimConfig.nearMiss.needed);
  });

  it("맞아 죽은 화살은 스침으로 치지 않는다", () => {
    const game = new JungnimGame();
    game.init(42);
    placeArrow(game, CENTER.x + HIT_RADIUS - 2, CENTER.y); // 피격 반경 안
    step(game, 1);
    expect(game.isPlayerDead()).toBe(true);
    expect(game.getGauge()).toBe(0);
  });

  it("init하면 게이지·발사 대기가 리셋된다", () => {
    const game = new JungnimGame();
    game.init(42);
    ringAroundPlayer(game, jungnimConfig.nearMiss.needed, GRAZE_DIST);
    step(game, 1);
    game.init(42);
    expect(game.getGauge()).toBe(0);
    expect(game.consumePendingFire()).toBeNull();
  });
});

describe("죽림고수 피격 디버프", () => {
  const positionAfter = (effect: (game: JungnimGame) => void, input: InputState, ticks: number): number => {
    const game = new JungnimGame();
    game.init(9999);
    effect(game);
    step(game, ticks, 0, input);
    return game.getPosition().x;
  };

  it("invert: 오른쪽 입력이 왼쪽으로 간다", () => {
    const inverted = positionAfter((g) => g.applyEffect("invert", 1000), MOVE_RIGHT, 10);
    const normal = positionAfter(() => {}, MOVE_LEFT, 10);
    expect(inverted).toBeCloseTo(normal);
    expect(inverted).toBeLessThan(CENTER.x);
  });

  it("invert: 지속시간이 끝나면 원래대로 돌아온다", () => {
    const game = new JungnimGame();
    game.init(9999);
    game.applyEffect("invert", 50); // 50ms = 3 tick
    step(game, 3, 0, MOVE_RIGHT); // 반전 구간 — 왼쪽으로 밀린다
    const afterInvert = game.getPosition().x;
    expect(afterInvert).toBeCloseTo(CENTER.x - jungnimConfig.playerSpeed * 3);
    step(game, 3, 3, MOVE_RIGHT); // 만료 후 — 다시 오른쪽
    expect(game.getPosition().x).toBeCloseTo(afterInvert + jungnimConfig.playerSpeed * 3);
  });

  it("sluggish: 이동이 느려지고 만료되면 원래 속도로 돌아온다", () => {
    const game = new JungnimGame();
    game.init(9999);
    game.applyEffect("sluggish", 50); // 3 tick
    step(game, 3, 0, MOVE_RIGHT);
    const slowed = game.getPosition().x - CENTER.x;
    expect(slowed).toBeCloseTo(jungnimConfig.playerSpeed * jungnimConfig.fire.sluggishSpeedMult * 3);
    const before = game.getPosition().x;
    step(game, 3, 3, MOVE_RIGHT);
    expect(game.getPosition().x - before).toBeCloseTo(jungnimConfig.playerSpeed * 3);
  });

  it("모르는 디버프는 무시한다", () => {
    const moved = positionAfter((g) => g.applyEffect("teleport", 1000), MOVE_RIGHT, 10);
    expect(moved).toBeCloseTo(CENTER.x + jungnimConfig.playerSpeed * 10);
  });

  it("죽은 뒤에는 디버프가 안 걸린다", () => {
    const game = new JungnimGame();
    game.init(42);
    placeArrow(game, CENTER.x + HIT_RADIUS - 2, CENTER.y);
    step(game, 1);
    expect(game.isPlayerDead()).toBe(true);
    const before = game.getPosition().x;
    game.applyEffect("invert", 1000);
    step(game, 5, 1, MOVE_RIGHT);
    expect(game.getPosition().x).toBe(before); // 죽으면 애초에 안 움직인다
  });
});
