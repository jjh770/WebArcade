import { describe, expect, it } from "vitest";
import type { IRenderer, InputState } from "@arcade/shared";
import { JungnimGame } from "../packages/games/jungnim/src/JungnimGame";
import { jungnimConfig } from "../packages/games/jungnim/src/config";
import type { ArrowPool } from "../packages/games/jungnim/src/ArrowPool";

const IDLE: InputState = { up: false, down: false, left: false, right: false };
const MOVE_RIGHT: InputState = { up: false, down: false, left: false, right: true };
const MOVE_LEFT: InputState = { up: false, down: false, left: true, right: false };
const MOVE_UP: InputState = { up: true, down: false, left: false, right: false };
const MOVE_DOWN: InputState = { up: false, down: true, left: false, right: false };

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

/* ---- 아이템(방해 발사) ------------------------------------------------------
   아이템이 자연히 뜰 때까지 돌리면 시드에 휘둘리므로, 뜨는 시각까지만 돌린 뒤
   플레이어를 그 자리로 순간이동시켜 판정만 본다.
   피격 테스트는 공통 풀에 **멈춘 화살**을 직접 놓는다(vx=vy=0이라 스스로 안 다가온다). */

const CENTER = { x: jungnimConfig.screenWidth / 2, y: jungnimConfig.screenHeight / 2 };
const HIT_RADIUS = jungnimConfig.playerRadius + jungnimConfig.arrowRadius;

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

function step(game: JungnimGame, ticks: number, from = 0, input: InputState = IDLE): void {
  for (let tick = from; tick < from + ticks; tick++) game.update(tick, input);
}

type Item = { x: number; y: number; bornTick: number; expireTick: number };

/** 지금 떠 있는 아이템(없으면 null). 화면 밖 상태라 내부를 직접 들여다본다. */
function itemOf(game: JungnimGame): Item | null {
  return (game as unknown as { items: { current: Item | null } }).items.current;
}

/** 플레이어를 그 자리로 옮긴다. 입력으로 걸어가면 시드가 만든 화살에 맞아 죽는다.
 *  ⚠️ 옮긴 자리에 마침 화살이 있으면 아이템을 먹기 전에 죽는다 — clearArrows와 함께 쓴다. */
function teleport(game: JungnimGame, x: number, y: number): void {
  const me = (game as unknown as { me: { x: number; y: number } }).me;
  me.x = x;
  me.y = y;
}

/** 날아다니는 화살을 모두 치운다. 아이템 판정만 보고 싶을 때(피격이 먼저 나면 안 될 때). */
function clearArrows(game: JungnimGame): void {
  const inner = game as unknown as { commonPool: ArrowPool; me: { pool: ArrowPool } };
  for (const pool of [inner.commonPool, inner.me.pool]) {
    for (const arrow of pool.items) pool.release(arrow);
  }
}

/** 아이템이 뜰 때까지 돌리고, 그 아이템과 다음 tick을 준다.
 *  ⚠️ 매 tick 화살을 치운다 — 가만히 선 플레이어는 아이템이 뜨는 10초 전에 죽어버리고,
 *  죽은 뒤에는 획득 판정이 아예 돌지 않는다. 아이템 일정은 별도 RNG라 영향받지 않는다. */
function runToItem(game: JungnimGame, from = 0): { item: Item; tick: number } {
  for (let tick = from; tick < from + 6000; tick++) {
    game.update(tick, IDLE);
    clearArrows(game);
    const item = itemOf(game);
    if (item) return { item, tick: tick + 1 };
  }
  throw new Error("아이템이 뜨지 않았다");
}

describe("죽림고수 아이템(자기 강화)", () => {
  it("초반 유예 동안엔 뜨지 않는다", () => {
    const game = new JungnimGame();
    game.init(42);
    step(game, jungnimConfig.item.unlockTick - 1);
    expect(itemOf(game)).toBeNull();
  });

  it("뜨는 시각·자리는 시드와 tick에서만 나온다 — 입력이 달라도 같다", () => {
    const idle = new JungnimGame();
    const moving = new JungnimGame();
    idle.init(4242);
    moving.init(4242);
    let first: Item | null = null;
    let second: Item | null = null;
    for (let tick = 0; tick < 3000 && !(first && second); tick++) {
      idle.update(tick, IDLE);
      moving.update(tick, MOVE_RIGHT); // 다르게 움직여도
      first ??= itemOf(idle);
      second ??= itemOf(moving);
    }
    expect(first).not.toBeNull();
    expect(second).toEqual(first); // 같은 자리, 같은 tick에 떴다
  });

  it("경기장 안 + 벽에서 여백만큼 떨어진 자리에 뜬다", () => {
    for (const seed of [1, 77, 12345, 99999]) {
      const game = new JungnimGame();
      game.init(seed);
      const { item } = runToItem(game);
      const { cx, cy, radius } = jungnimConfig.arena;
      expect(Math.hypot(item.x - cx, item.y - cy)).toBeLessThanOrEqual(radius - jungnimConfig.item.edgeMargin);
    }
  });

  it("종류도 시드에서 뽑는다 — 같은 시드면 같은 종류, 가중치대로 섞인다", () => {
    const a = new JungnimGame();
    const b = new JungnimGame();
    a.init(555);
    b.init(555);
    expect(runToItem(a).item.kind).toBe(runToItem(b).item.kind);

    // 시드를 바꾸며 모아보면 설정한 4종이 모두 나온다(가중치 분포까지는 보지 않는다).
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const game = new JungnimGame();
      game.init(seed);
      kinds.add(runToItem(game).item.kind);
    }
    expect([...kinds].sort()).toEqual(jungnimConfig.item.kinds.map((k) => k.kind).sort());
  });

  it("닿으면 아이템이 사라진다", () => {
    const game = new JungnimGame();
    game.init(42);
    const { item, tick } = runToItem(game);
    clearArrows(game);
    teleport(game, item.x, item.y);
    step(game, 1, tick);
    expect(itemOf(game)).toBeNull();
  });

  it("획득 반경 밖이면 먹히지 않는다", () => {
    const game = new JungnimGame();
    game.init(42);
    const { item, tick } = runToItem(game);
    const reach = jungnimConfig.playerRadius + jungnimConfig.item.radius;
    clearArrows(game);
    teleport(game, item.x + reach + 2, item.y);
    step(game, 1, tick);
    expect(itemOf(game)).not.toBeNull();
  });

  it("안 먹으면 수명이 지나 사라진다", () => {
    const game = new JungnimGame();
    game.init(42);
    const { item, tick } = runToItem(game);
    step(game, jungnimConfig.item.lifetimeTicks + 1, tick); // 그 자리에 가지 않는다
    expect(itemOf(game)).toBeNull();
    expect(item.expireTick - item.bornTick).toBe(jungnimConfig.item.lifetimeTicks);
  });

  // 획득이 스폰 일정을 흔들면 그때부터 클라마다 아이템 시각이 어긋난다.
  it("내가 먹든 말든 다음 아이템 시각은 같다", () => {
    const taker = new JungnimGame();
    const idler = new JungnimGame();
    taker.init(31337);
    idler.init(31337);
    const first = runToItem(taker);
    runToItem(idler);
    clearArrows(taker);
    teleport(taker, first.item.x, first.item.y); // 한쪽만 먹는다
    taker.update(first.tick, IDLE);
    expect(itemOf(taker)).toBeNull();

    // 첫 아이템이 아니라 **다음** 아이템이 뜬 tick을 본다.
    const nextItemUp = (game: JungnimGame): boolean => (itemOf(game)?.bornTick ?? -1) > first.item.bornTick;
    let takerNext = -1;
    let idlerNext = -1;
    for (let tick = first.tick + 1; tick < first.tick + 4000; tick++) {
      taker.update(tick, IDLE);
      idler.update(tick, IDLE);
      teleport(taker, CENTER.x, CENTER.y); // 두 번째는 안 먹게 중앙으로 되돌린다
      if (takerNext < 0 && nextItemUp(taker)) takerNext = tick;
      if (idlerNext < 0 && nextItemUp(idler)) idlerNext = tick;
      if (takerNext > 0 && idlerNext > 0) break;
    }
    expect(takerNext).toBeGreaterThan(0);
    expect(takerNext).toBe(idlerNext);
  });

  it("죽는 프레임에 겹쳐 있어도 먹지 않는다", () => {
    const game = new JungnimGame();
    game.init(42);
    const { item, tick } = runToItem(game);
    clearArrows(game);
    teleport(game, item.x, item.y);
    placeArrow(game, item.x + HIT_RADIUS - 2, item.y); // 같은 자리에 피격
    step(game, 1, tick);
    expect(game.isPlayerDead()).toBe(true);
    expect(itemOf(game)).not.toBeNull(); // 먹지 않았다
  });

  it("init하면 아이템이 리셋된다", () => {
    const game = new JungnimGame();
    game.init(42);
    const { item, tick } = runToItem(game);
    clearArrows(game);
    teleport(game, item.x, item.y);
    step(game, 1, tick);
    game.init(42);
    expect(itemOf(game)).toBeNull();
  });
});

/* ---- 종류별 효과 --------------------------------------------------------------
   어떤 종류가 뜰지는 시드가 정하므로, 효과만 보고 싶을 땐 뜬 아이템의 종류를 갈아끼운다. */

/** 지정한 종류로 바꿔 먹인다. 먹은 다음 tick을 돌려준다. */
function takeKind(game: JungnimGame, kind: string): number {
  const { item, tick } = runToItem(game);
  (item as { kind: string }).kind = kind;
  clearArrows(game);
  teleport(game, item.x, item.y);
  game.update(tick, IDLE);
  clearArrows(game); // 먹는 tick에 스폰된 화살까지 치워 다음 관찰을 깨끗하게 시작한다
  return tick + 1;
}

/** 화살에 안 맞게 매 tick 치우면서 입력을 넣는다(효과만 관찰). */
function driveClear(game: JungnimGame, ticks: number, from: number, input: InputState): void {
  for (let tick = from; tick < from + ticks; tick++) {
    game.update(tick, input);
    clearArrows(game);
  }
}

function activeArrows(game: JungnimGame, which: "common" | "personal"): number {
  const inner = game as unknown as { commonPool: ArrowPool; me: { pool: ArrowPool } };
  const pool = which === "common" ? inner.commonPool : inner.me.pool;
  return pool.items.filter((arrow) => arrow.active).length;
}

describe("죽림고수 아이템 효과", () => {
  it("질주: 같은 시간에 더 멀리 간다", () => {
    const plain = new JungnimGame();
    const dashing = new JungnimGame();
    plain.init(42);
    dashing.init(42);
    const tick = takeKind(dashing, "dash");
    runToItem(plain); // 같은 지점까지 돌려 조건을 맞춘다
    teleport(plain, CENTER.x, CENTER.y);
    teleport(dashing, CENTER.x, CENTER.y);

    driveClear(plain, 30, tick, MOVE_RIGHT);
    driveClear(dashing, 30, tick, MOVE_RIGHT);
    const moved = (game: JungnimGame): number => game.getPosition().a - CENTER.x;
    expect(moved(dashing) / moved(plain)).toBeCloseTo(jungnimConfig.item.dash.speedMult, 2);
  });

  it("질주: 지속시간이 끝나면 원래 속도로 돌아온다", () => {
    const game = new JungnimGame();
    game.init(42);
    const tick = takeKind(game, "dash");
    driveClear(game, jungnimConfig.item.dash.durationTicks, tick, IDLE); // 서 있어도 시간은 간다
    teleport(game, CENTER.x, CENTER.y);
    const after = tick + jungnimConfig.item.dash.durationTicks;
    driveClear(game, 10, after, MOVE_RIGHT);
    expect(game.getPosition().a - CENTER.x).toBeCloseTo(10 * jungnimConfig.playerSpeed, 1);
  });

  it("쉴드: 맞은 화살은 부서지고 횟수만큼 버틴 뒤 죽는다", () => {
    const game = new JungnimGame();
    game.init(42);
    let tick = takeKind(game, "shield");
    const { a: x, b: y } = game.getPosition();
    for (let i = 0; i < jungnimConfig.item.shield.charges; i++) {
      placeArrow(game, x, y);
      game.update(tick++, IDLE);
      expect(game.isPlayerDead()).toBe(false);
      expect(activeArrows(game, "common")).toBe(0); // 막은 화살은 부서졌다
    }
    placeArrow(game, x, y); // 다 쓴 뒤 한 발 더
    game.update(tick, IDLE);
    expect(game.isPlayerDead()).toBe(true);
  });

  // ⚠️ 매 tick 화살을 치우므로 "쌓인 양"으로는 못 센다 — 치우기 전에 세서 그 tick에
  //    새로 나왔는지만 본다.
  const personalSpawnedDuring = (game: JungnimGame, ticks: number, from: number): number => {
    let seen = 0;
    for (let tick = from; tick < from + ticks; tick++) {
      game.update(tick, IDLE);
      seen = Math.max(seen, activeArrows(game, "personal"));
      clearArrows(game);
    }
    return seen;
  };

  it("조준 정지: 개인 화살이 새로 안 생긴다(끝나면 다시 생긴다)", () => {
    const focused = new JungnimGame();
    const plain = new JungnimGame();
    focused.init(42);
    plain.init(42);
    const tick = takeKind(focused, "focus");
    runToItem(plain);
    const span = jungnimConfig.item.focus.durationTicks;

    expect(personalSpawnedDuring(focused, span, tick)).toBe(0);
    expect(personalSpawnedDuring(plain, span, tick)).toBeGreaterThan(0); // 대조군은 계속 조준당한다

    const after = jungnimConfig.personal.intervalTicks + 2;
    expect(personalSpawnedDuring(focused, after, tick + span)).toBeGreaterThan(0); // 끝나면 돌아온다
  });

  it("정화: 반경 안 화살만 지운다", () => {
    const game = new JungnimGame();
    game.init(42);
    const { item, tick } = runToItem(game);
    const radius = jungnimConfig.item.purge.radius;
    // ⚠️ 아이템을 한쪽으로 옮겨 둔다 — 반경이 커서, 중앙에서 재면 "반경 밖" 지점이
    //    경기장 밖으로 나가 화살이 컬링돼 버린다(정화가 아니라 컬링을 재게 된다).
    const mutable = item as { kind: string; x: number; y: number };
    mutable.kind = "purge";
    mutable.x = CENTER.x - radius * 0.9;
    mutable.y = CENTER.y;
    clearArrows(game);
    teleport(game, mutable.x, mutable.y);
    placeArrow(game, mutable.x + (radius - 20), mutable.y); // 반경 안
    placeArrow(game, mutable.x + 20, mutable.y); // 바로 옆
    placeArrow(game, mutable.x + (radius + 40), mutable.y); // 반경 밖(경기장 안)
    game.update(tick, IDLE);
    expect(activeArrows(game, "common")).toBe(1); // 밖의 한 발만 남는다
  });
});

/* 화면 표시는 렌더러가 받은 인자로 확인한다. 아이템 원은 종류마다 색이 다르다. */
const colorOf = (kind: string): string => jungnimConfig.item.kinds.find((entry) => entry.kind === kind)!.color;
const kindLabelOf = (kind: string): string => jungnimConfig.item.kinds.find((entry) => entry.kind === kind)!.label;

const COMMON_ARROW_COLOR = "#1d3557";

class CaptureCalls implements IRenderer {
  readonly width = 800;
  readonly height = 800;
  readonly texts: string[] = [];
  readonly circles: { x: number; y: number; color: string }[] = [];
  readonly lines: { x1: number; y1: number; color: string }[] = [];
  clear(): void {}
  rect(): void {}
  line(x1: number, y1: number, _x2: number, _y2: number, color: string): void {
    this.lines.push({ x1, y1, color });
  }
  circle(x: number, y: number, _radius: number, color: string): void {
    this.circles.push({ x, y, color });
  }
  text(value: string): void {
    this.texts.push(value);
  }
}

function drawn(game: JungnimGame): CaptureCalls {
  const renderer = new CaptureCalls();
  game.render(renderer, 0);
  return renderer;
}

/* ---- 정화 파동의 관전 동기화 ---------------------------------------------------
   정화는 **내 화면에서만** 화살을 지운다. 그대로 두면 나를 보는 사람 화면엔 화살이 남아
   내가 유령처럼 보인다. 그래서 "정화했다"만 알리고, 받은 쪽은 퍼지는 파동 안쪽 화살을
   안 그려 같은 그림을 만든다(자기 공통 풀은 그대로 둔다 — 지우면 자기 판정이 바뀐다). */
describe("죽림고수 정화 파동 — 관전 동기화", () => {
  const spectate = (game: JungnimGame, id: string, x: number, y: number): CaptureCalls => {
    const renderer = new CaptureCalls();
    game.renderSpectator(renderer, { id, a: x, b: y, label: "남" });
    return renderer;
  };
  const commonArrowsAt = (frame: CaptureCalls, x: number, y: number, within: number): number =>
    frame.lines.filter((l) => l.color === COMMON_ARROW_COLOR && Math.hypot(l.x1 - x, l.y1 - y) <= within).length;

  it("정화를 쓰면 남들에게 알릴 이벤트가 한 번 나온다", () => {
    const game = new JungnimGame();
    game.init(42);
    takeKind(game, "purge");
    expect(game.consumePeerEvent()).toBe("purge");
    expect(game.consumePeerEvent()).toBeNull(); // 한 번만
  });

  it("다른 종류를 먹었을 땐 알릴 게 없다", () => {
    for (const kind of ["dash", "shield", "focus"]) {
      const game = new JungnimGame();
      game.init(42);
      takeKind(game, kind);
      expect(game.consumePeerEvent()).toBeNull();
    }
  });

  it("남의 정화를 받으면 그 사람 관전 화면에서 파동 안쪽 화살이 사라진다", () => {
    const game = new JungnimGame();
    game.init(42);
    step(game, 1);
    game.syncPeers([{ id: "other", a: CENTER.x, b: CENTER.y, label: "남" }]);
    clearArrows(game);
    placeArrow(game, CENTER.x + 40, CENTER.y); // 파동 안쪽에 들 화살
    placeArrow(game, CENTER.x + 300, CENTER.y); // 반경(280) 밖 — 계속 보여야 한다

    game.applyPeerEvent("other", "purge");
    step(game, 12, 1); // 파동이 절반쯤 퍼진 시점
    const frame = spectate(game, "other", CENTER.x, CENTER.y);
    expect(commonArrowsAt(frame, CENTER.x + 40, CENTER.y, 30)).toBe(0); // 안쪽은 안 그린다
    expect(commonArrowsAt(frame, CENTER.x + 300, CENTER.y, 30)).toBe(1); // 밖은 그대로

    // 내 화면(내 판정)은 건드리지 않는다 — 두 발 다 남아 있다.
    expect(activeArrows(game, "common")).toBe(2);
  });

  it("파동이 끝나면 다시 정상으로 그린다", () => {
    const game = new JungnimGame();
    game.init(42);
    step(game, 1);
    game.syncPeers([{ id: "other", a: CENTER.x, b: CENTER.y, label: "남" }]);
    clearArrows(game);
    placeArrow(game, CENTER.x + 40, CENTER.y);
    game.applyPeerEvent("other", "purge");
    step(game, jungnimConfig.item.purge.ringTicks + 2, 1);
    const frame = spectate(game, "other", CENTER.x, CENTER.y);
    expect(commonArrowsAt(frame, CENTER.x + 40, CENTER.y, 30)).toBe(1);
  });

  it("모르는 이벤트·없는 사람은 무시한다", () => {
    const game = new JungnimGame();
    game.init(42);
    step(game, 1);
    game.syncPeers([{ id: "other", a: CENTER.x, b: CENTER.y, label: "남" }]);
    clearArrows(game);
    placeArrow(game, CENTER.x + 40, CENTER.y);
    game.applyPeerEvent("other", "미래에_생길_이벤트");
    game.applyPeerEvent("ghost", "purge");
    step(game, 12, 1);
    expect(commonArrowsAt(spectate(game, "other", CENTER.x, CENTER.y), CENTER.x + 40, CENTER.y, 30)).toBe(1);
  });
});

describe("죽림고수 아이템 표시", () => {
  it("종류마다 다른 색으로 그리고, 먹으면 화면에서 사라진다", () => {
    const game = new JungnimGame();
    game.init(42);
    const { item, tick } = runToItem(game);
    const itemDrawn = (frame: CaptureCalls): boolean =>
      frame.circles.some((c) => c.color === colorOf(item.kind) && Math.hypot(c.x - item.x, c.y - item.y) < 1);

    expect(itemDrawn(drawn(game))).toBe(true);
    clearArrows(game);
    teleport(game, item.x, item.y);
    step(game, 1, tick);
    expect(itemDrawn(drawn(game))).toBe(false);
  });

  it("먹으면 그 자리에서 불꽃이 잠깐 튀고 사라진다", () => {
    const game = new JungnimGame();
    game.init(42);
    const { item, tick } = runToItem(game);
    teleport(game, item.x, item.y);
    step(game, 1, tick);
    // 불꽃은 아이템 중심에서 떨어진 자리에 뿌려진다(아이템 원 자체와 구분).
    const sparks = (frame: CaptureCalls): number =>
      frame.circles.filter((c) => c.color === colorOf(item.kind) && Math.hypot(c.x - item.x, c.y - item.y) > 5).length;
    expect(sparks(drawn(game))).toBeGreaterThan(0);
    step(game, 30, tick + 1); // 연출 시간(20tick)보다 길게
    expect(sparks(drawn(game))).toBe(0);
  });

  it("주운 순간 종류 이름이 그 자리에 뜬다", () => {
    // 정화는 지속 효과가 없어 이 한 번이 유일한 이름표다 — 빠지면 아무것도 안 뜬다.
    for (const kind of jungnimConfig.item.kinds.map((entry) => entry.kind)) {
      const game = new JungnimGame();
      game.init(42);
      takeKind(game, kind);
      expect(drawn(game).texts).toContain(`${kindLabelOf(kind)}!`);
    }
  });

  it("걸린 효과를 플레이어 옆에 적는다", () => {
    const game = new JungnimGame();
    game.init(42);
    takeKind(game, "shield");
    expect(drawn(game).texts).toContain(`${kindLabelOf("shield")} ${jungnimConfig.item.shield.charges}`);
  });

  it("관전 화면에도 같은 아이템이 보인다", () => {
    const game = new JungnimGame();
    game.init(42);
    const { item } = runToItem(game);
    const renderer = new CaptureCalls();
    game.renderSpectator(renderer, { id: "other", a: CENTER.x, b: CENTER.y, label: "남" });
    expect(renderer.circles.some((c) => c.color === colorOf(item.kind) && Math.hypot(c.x - item.x, c.y - item.y) < 1)).toBe(true);
  });
});

describe("죽림고수 피격 디버프", () => {
  const positionAfter = (effect: (game: JungnimGame) => void, input: InputState, ticks: number): number => {
    const game = new JungnimGame();
    game.init(9999);
    effect(game);
    step(game, ticks, 0, input);
    return game.getPosition().a;
  };

  it("invert: 오른쪽 입력이 왼쪽으로 간다", () => {
    const inverted = positionAfter((g) => g.applyEffect("invert", 1000), MOVE_RIGHT, 10);
    const normal = positionAfter(() => {}, MOVE_LEFT, 10);
    expect(inverted).toBeCloseTo(normal);
    expect(inverted).toBeLessThan(CENTER.x);
  });

  it("invert: 상하도 함께 뒤집힌다(4방향 전부)", () => {
    const game = new JungnimGame();
    game.init(9999);
    game.applyEffect("invert", 1000);
    step(game, 10, 0, MOVE_DOWN); // 아래를 눌렀는데 위로 가야 한다
    const inverted = game.getPosition();
    expect(inverted.b).toBeCloseTo(CENTER.y - jungnimConfig.playerSpeed * 10);

    const plain = new JungnimGame();
    plain.init(9999);
    step(plain, 10, 0, MOVE_UP); // 반전 없이 위로 간 것과 같은 자리
    expect(inverted.b).toBeCloseTo(plain.getPosition().b);
  });

  it("invert: 지속시간이 끝나면 원래대로 돌아온다", () => {
    const game = new JungnimGame();
    game.init(9999);
    game.applyEffect("invert", 50); // 50ms = 3 tick
    step(game, 3, 0, MOVE_RIGHT); // 반전 구간 — 왼쪽으로 밀린다
    const afterInvert = game.getPosition().a;
    expect(afterInvert).toBeCloseTo(CENTER.x - jungnimConfig.playerSpeed * 3);
    step(game, 3, 3, MOVE_RIGHT); // 만료 후 — 다시 오른쪽
    expect(game.getPosition().a).toBeCloseTo(afterInvert + jungnimConfig.playerSpeed * 3);
  });

  it("sluggish: 이동이 느려지고 만료되면 원래 속도로 돌아온다", () => {
    const game = new JungnimGame();
    game.init(9999);
    game.applyEffect("sluggish", 50); // 3 tick
    step(game, 3, 0, MOVE_RIGHT);
    const slowed = game.getPosition().a - CENTER.x;
    expect(slowed).toBeCloseTo(jungnimConfig.playerSpeed * jungnimConfig.fire.sluggishSpeedMult * 3);
    const before = game.getPosition().a;
    step(game, 3, 3, MOVE_RIGHT);
    expect(game.getPosition().a - before).toBeCloseTo(jungnimConfig.playerSpeed * 3);
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
    const before = game.getPosition().a;
    game.applyEffect("invert", 1000);
    step(game, 5, 1, MOVE_RIGHT);
    expect(game.getPosition().a).toBe(before); // 죽으면 애초에 안 움직인다
  });
});
