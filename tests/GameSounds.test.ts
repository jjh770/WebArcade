/* 게임이 내는 소리 — IGame.consumeSounds → GameRunner → 앱.

   여기서 지켜야 할 것은 두 가지다.
   1) 소리는 **판을 바꾸지 않는다.** 아무도 안 가져가도, 매 tick 가져가도 월드가 같아야 한다.
      이게 깨지면 소리 때문에 결정론이 갈린다 — 멀티에서 서로 다른 판을 보게 된다.
   2) 한 프레임에 고정 스텝이 여러 번 돌아도(따라잡기) 같은 소리가 겹쳐 나지 않는다. */
import { describe, expect, it, vi } from "vitest";
import type { IGame, IRenderer, InputState } from "@arcade/shared";
import type { InputSource } from "../packages/core/src/input/InputSource";
import { GameRunner } from "../packages/core/src/GameRunner";
import { CurveGame } from "../packages/games/curve/src/CurveGame";
import { JungnimGame } from "../packages/games/jungnim/src/JungnimGame";
import { jungnimConfig } from "../packages/games/jungnim/src/config";

const IDLE: InputState = { up: false, down: false, left: false, right: false };
const TURN_RIGHT: InputState = { up: false, down: false, left: false, right: true };

/** 게임을 tick만큼 굴리며 매 tick 위치를 찍는다. drain이면 소리도 매 tick 가져간다. */
function runPositions(game: IGame, ticks: number, input: InputState, drain: boolean): string[] {
  game.init(12345);
  const path: string[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    game.update(tick, input);
    if (drain) game.consumeSounds?.();
    const p = game.getPosition();
    path.push(`${p.x.toFixed(6)},${p.y.toFixed(6)}`);
  }
  return path;
}

describe("게임 소리 — 판을 바꾸지 않는다", () => {
  it("커브 피버: 소리를 매 tick 가져가든 한 번도 안 가져가든 경로가 같다", () => {
    const drained = runPositions(new CurveGame(), 600, TURN_RIGHT, true);
    const ignored = runPositions(new CurveGame(), 600, TURN_RIGHT, false);
    expect(drained).toEqual(ignored);
  });

  it("죽림고수: 소리를 매 tick 가져가든 한 번도 안 가져가든 경로가 같다", () => {
    const drained = runPositions(new JungnimGame(), 600, TURN_RIGHT, true);
    const ignored = runPositions(new JungnimGame(), 600, TURN_RIGHT, false);
    expect(drained).toEqual(ignored);
  });

  it("아무도 안 가져가도 버퍼가 쌓이지 않는다 — Set이라 어휘 수가 상한이다", () => {
    const game = new CurveGame();
    game.init(999);
    for (let tick = 0; tick < 3000; tick++) game.update(tick, TURN_RIGHT);
    const pending = game.consumeSounds();
    expect((pending ?? []).length).toBeLessThanOrEqual(4); // 커브의 소리 어휘는 graze·fire뿐
  });
});

describe("게임 소리 — 언제 나고 언제 안 나는가", () => {
  it("커브 피버: 스치면 소리가 나되 쿨다운보다 자주 나지 않는다", () => {
    const game = new CurveGame();
    game.init(4242);
    const TICKS = 900;
    let grazes = 0;
    let alive = 0;
    for (let tick = 0; tick < TICKS; tick++) {
      game.update(tick, TURN_RIGHT); // 계속 돌면 벽·자기 꼬리를 스친다
      if (game.isPlayerDead()) break;
      alive++;
      if ((game.consumeSounds() ?? []).includes("graze")) grazes++;
    }
    expect(grazes).toBeGreaterThan(0); // 스침이 실제로 일어났다
    // 쿨다운 15tick — 살아있던 구간에서 이보다 자주 날 수 없다(+1은 첫 소리 몫).
    expect(grazes).toBeLessThanOrEqual(Math.ceil(alive / 15) + 1);
  });

  it("죽은 뒤에는 소리를 내지 않는다 — 공통 월드는 돌지만 그건 남의 판이다", () => {
    const game = new CurveGame();
    game.init(4242);
    let tick = 0;
    while (!game.isPlayerDead() && tick < 5000) game.update(tick++, TURN_RIGHT);
    expect(game.isPlayerDead()).toBe(true);
    game.consumeSounds(); // 죽는 순간까지 쌓인 것을 비운다
    for (let i = 0; i < 300; i++) game.update(tick++, TURN_RIGHT);
    expect(game.consumeSounds()).toBeNull();
  });

  it("아무 일도 없으면 null이다 — 빈 배열을 흘려보내지 않는다", () => {
    const game = new JungnimGame();
    game.init(7);
    game.update(0, IDLE);
    expect(game.consumeSounds()).toBeNull();
  });

  it("죽림고수: 아이템을 주우면 pickup이 난다", () => {
    // 아이템은 tick 600부터 뜨는데 가만히 서 있으면 그 전에 죽는다. 그래서 돌아다니다가
    // 아이템이 보이면 그쪽으로 붙는 조종기를 쓴다. 시드 14는 이 조종으로 살아남아 줍는다.
    const game = new JungnimGame();
    game.init(14);
    const probe = new ItemProbe();
    let picked = false;
    let phase = 6;
    for (let tick = 0; tick < 1200 && !picked && !game.isPlayerDead(); tick++) {
      // 아이템 위치는 내부 필드가 아니라 **렌더 출력**에서 읽는다(십자 표시의 중점).
      game.render(probe.reset(), 0);
      if (tick % 37 === 0) phase = (phase * 5 + 3) % WANDER.length; // 결정론적 방향 전환
      game.update(tick, probe.item ? towards(game.getPosition(), probe.item) : WANDER[phase]);
      picked = (game.consumeSounds() ?? []).includes("pickup");
    }
    expect(game.isPlayerDead()).toBe(false); // 줍기 전에 죽었으면 이 테스트는 아무것도 안 본 것
    expect(picked).toBe(true);
  });
});

/** 8방향 순환. 한자리에 서 있으면 조준 화살에 금방 죽어 아이템이 뜰 때까지 못 산다. */
const WANDER: readonly InputState[] = [
  { up: false, down: false, left: false, right: true },
  { up: false, down: true, left: false, right: true },
  { up: false, down: true, left: false, right: false },
  { up: false, down: true, left: true, right: false },
  { up: false, down: false, left: true, right: false },
  { up: true, down: false, left: true, right: false },
  { up: true, down: false, left: false, right: false },
  { up: true, down: false, left: false, right: true },
];

/** 아이템은 종류색으로 그린 십자(가로·세로 선)를 갖는다. 가로선의 중점이 곧 아이템 좌표다. */
class ItemProbe implements IRenderer {
  readonly width = 800;
  readonly height = 800;
  item: { x: number; y: number } | null = null;
  private static readonly COLORS = new Set(jungnimConfig.item.kinds.map((k) => k.color));
  reset(): this {
    this.item = null;
    return this;
  }
  clear(): void {}
  circle(): void {}
  rect(): void {}
  text(): void {}
  line(x1: number, y1: number, x2: number, y2: number, color: string): void {
    if (y1 !== y2 || !ItemProbe.COLORS.has(color)) return; // 가로선만
    this.item = { x: (x1 + x2) / 2, y: y1 };
  }
}

/** 목표 쪽으로 미는 8방향 입력. 축마다 여유를 둬 목표 위에서 덜덜 떨지 않게 한다. */
function towards(from: { x: number; y: number }, to: { x: number; y: number }): InputState {
  const slack = 2;
  return {
    left: to.x < from.x - slack,
    right: to.x > from.x + slack,
    up: to.y < from.y - slack,
    down: to.y > from.y + slack,
  };
}

/* ---- 러너: 프레임 단위로 모아서 한 번 ------------------------------------ */

/** 매 스텝 지정한 슬러그를 내는 가짜 게임. 러너가 슬러그의 뜻을 모른다는 걸 그대로 보여준다. */
class SoundyGame implements IGame {
  steps = 0;
  constructor(private readonly perStep: (step: number) => string[]) {}
  init(): void {
    this.steps = 0;
  }
  update(): void {
    this.steps++;
  }
  render(): void {}
  renderSpectator(): void {}
  isPlayerDead(): boolean {
    return false;
  }
  getPosition(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }
  getScore(): number {
    return 0;
  }
  consumeSounds(): readonly string[] | null {
    return this.perStep(this.steps - 1);
  }
}

const STUB_INPUT: InputSource = {
  start: () => {},
  stop: () => {},
  getState: () => ({ ...IDLE }),
};

/** 한 프레임에 고정 스텝이 여러 번 도는 상황(따라잡기)을 만들고 그 프레임의 소리를 돌려준다. */
function soundsInCatchUpFrame(perStep: (step: number) => string[]): { heard: string[][]; steps: number } {
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

  const game = new SoundyGame(perStep);
  const heard: string[][] = [];
  const runner = new GameRunner(game, STUB_INPUT, undefined, undefined, undefined, (slugs) => heard.push([...slugs]));
  runner.start(1, 1000);
  now = 1101; // 100ms 밀렸다 → 고정 스텝 6번이 한 프레임에 몰린다
  frame?.(now);
  runner.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return { heard, steps: game.steps };
}

describe("러너 — 프레임마다 한 번, 중복 없이", () => {
  it("같은 소리가 여러 스텝에 나도 프레임당 한 번만 내보낸다", () => {
    const { heard, steps } = soundsInCatchUpFrame(() => ["graze"]);
    expect(steps).toBeGreaterThan(1); // 따라잡기가 실제로 일어났다
    expect(heard).toEqual([["graze"]]);
  });

  it("한 프레임에 난 서로 다른 소리는 모두 전달한다", () => {
    const { heard } = soundsInCatchUpFrame((step) => (step % 2 === 0 ? ["graze"] : ["fire"]));
    expect(heard).toHaveLength(1);
    expect([...heard[0]].sort()).toEqual(["fire", "graze"]);
  });

  it("소리가 없으면 아예 부르지 않는다", () => {
    const { heard } = soundsInCatchUpFrame(() => []);
    expect(heard).toEqual([]);
  });
});
