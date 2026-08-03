/* ============================================================
   터치 입력 — 매핑과 합성
   ------------------------------------------------------------
   조작이라 틀리면 바로 게임이 안 된다. DOM 없이 확인할 수 있는 두 축만 잡는다.
   - 누른 자리 → 방향 (TouchMapper)
   - 여러 소스 → 하나의 InputState (mergeInputs)
   실제 포인터 이벤트 처리는 브라우저에서 확인한다.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { mergeInputs } from "../packages/core/src/input/InputSource";
import { joystick8, splitLeftRight } from "../packages/core/src/input/TouchInput";
import { ButtonInput, type Direction } from "../packages/core/src/input/ButtonInput";
import { FloorGame } from "../packages/games/floor/src/FloorGame";
import { shouldShowHint } from "../packages/app/src/touchHint";
import type { InputState } from "../packages/shared/src/types";

const NONE: InputState = { up: false, down: false, left: false, right: false };
const of = (part: Partial<InputState>): InputState => ({ ...NONE, ...part });

describe("좌우 절반 매핑", () => {
  it("왼쪽 절반은 좌회전", () => {
    expect(splitLeftRight(0, 0.5)).toEqual({ left: true });
    expect(splitLeftRight(0.49, 0.5)).toEqual({ left: true });
  });

  it("오른쪽 절반은 우회전", () => {
    expect(splitLeftRight(0.5, 0.5)).toEqual({ right: true });
    expect(splitLeftRight(1, 0.5)).toEqual({ right: true });
  });

  it("세로 위치는 무관하다 — 화면 어느 높이를 눌러도 같다", () => {
    for (const ny of [0, 0.2, 0.8, 1]) expect(splitLeftRight(0.2, ny)).toEqual({ left: true });
  });
});

describe("조이스틱 위젯 (8방향)", () => {
  /** 위젯 중심에서 (dx, dy)만큼 민 결과. */
  const push = (dx: number, dy: number): Partial<InputState> => joystick8(0.5 + dx, 0.5 + dy);

  it("가운데를 짚기만 하면 제자리다 — 손을 얹었다고 캐릭터가 튀면 안 된다", () => {
    expect(push(0, 0)).toEqual({});
    expect(push(0.1, 0.05)).toEqual({}); // 데드존 안
  });

  it("네 방향. 아래로 밀면 아래로 간다(y는 화면 아래가 +)", () => {
    expect(push(0.3, 0)).toEqual({ right: true });
    expect(push(-0.3, 0)).toEqual({ left: true });
    expect(push(0, -0.3)).toEqual({ up: true });
    expect(push(0, 0.3)).toEqual({ down: true });
  });

  it("대각선 네 방향", () => {
    expect(push(0.3, -0.3)).toEqual({ right: true, up: true });
    expect(push(-0.3, -0.3)).toEqual({ left: true, up: true });
    expect(push(-0.3, 0.3)).toEqual({ left: true, down: true });
    expect(push(0.3, 0.3)).toEqual({ right: true, down: true });
  });

  it("거의 수평이면 대각선이 아니라 수평이다 — 축별 임계값이면 여기서 틀린다", () => {
    // 오른쪽으로 크게, 아래로 살짝. 45도의 절반(22.5도)을 안 넘으므로 오른쪽뿐이다.
    expect(push(0.4, 0.08)).toEqual({ right: true });
  });

  it("위젯 가장자리든 살짝 벗어난 정도든 방향만 남는다 — 세기 개념이 없다", () => {
    expect(push(0.45, 0)).toEqual(push(0.2, 0));
  });
});

/* ---- 방향키 버튼 -------------------------------------------------------
   DOM 없이 확인한다. 버튼이 하는 일은 "이 요소에 손가락이 있는가"뿐이라
   진짜 요소가 필요 없다 — 리스너를 받아 두었다가 불러 주는 가짜면 충분하다.
   실제 배치·크기는 브라우저에서 잰다. */

type Listener = (event: FakePointerEvent) => void;
type FakePointerEvent = { pointerId: number; pointerType: string; preventDefault: () => void };

class FakeButton {
  private readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  /** 이 버튼에 리스너가 하나라도 남아 있는가 — stop()이 정말 걷었는지 본다. */
  get listenerCount(): number {
    return [...this.listeners.values()].reduce((n, list) => n + list.length, 0);
  }
  fire(type: string, pointerId: number, pointerType = "touch"): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ pointerId, pointerType, preventDefault: () => {} });
    }
  }
}

/** 방향키 버튼 넷 + 그것을 읽는 입력 소스. */
const makePad = (): { input: ButtonInput; press: (dir: Direction, id?: number) => void;
                     release: (dir: Direction, id?: number, type?: string) => void;
                     buttons: Record<Direction, FakeButton> } => {
  const buttons = { up: new FakeButton(), down: new FakeButton(), left: new FakeButton(), right: new FakeButton() };
  const input = new ButtonInput(
    (Object.keys(buttons) as Direction[]).map((direction) => ({
      element: buttons[direction] as unknown as HTMLElement,
      direction,
    })),
  );
  input.start();
  return {
    input,
    buttons,
    press: (dir, id = 1) => buttons[dir].fire("pointerdown", id),
    release: (dir, id = 1, type = "pointerup") => buttons[dir].fire(type, id),
  };
};

describe("방향키 버튼", () => {
  it("누른 버튼이 곧 방향이다 — 좌표도 데드존도 없다", () => {
    const pad = makePad();
    pad.press("up");
    expect(pad.input.getState()).toEqual(of({ up: true }));
  });

  it("떼면 사라진다", () => {
    const pad = makePad();
    pad.press("left");
    pad.release("left");
    expect(pad.input.getState()).toEqual(NONE);
  });

  it("pointercancel도 뗀 것으로 친다 — 안 그러면 방향이 눌린 채 굳는다", () => {
    const pad = makePad();
    pad.press("right");
    pad.release("right", 1, "pointercancel");
    expect(pad.input.getState()).toEqual(NONE);
  });

  it("두 손가락이면 두 방향이 동시에 눌린다 — 게임이 판단할 몫이다", () => {
    const pad = makePad();
    pad.press("up", 1);
    pad.press("right", 2);
    expect(pad.input.getState()).toEqual(of({ up: true, right: true }));
    pad.release("up", 1);
    expect(pad.input.getState()).toEqual(of({ right: true }));
  });

  it("마우스는 무시한다 — 데스크톱의 조작은 방향키다", () => {
    const pad = makePad();
    pad.buttons.down.fire("pointerdown", 1, "mouse");
    expect(pad.input.getState()).toEqual(NONE);
  });

  it("stop()은 리스너도 눌림도 걷는다 — 정지 후 유령 입력 방지", () => {
    const pad = makePad();
    pad.press("down");
    pad.input.stop();
    expect(pad.input.getState()).toEqual(NONE);
    expect(pad.buttons.down.listenerCount).toBe(0);
    pad.press("down"); // 걷힌 뒤라 아무 일도 없어야 한다
    expect(pad.input.getState()).toEqual(NONE);
  });
});

describe("방향키 버튼으로 무너지는 바닥 조작하기", () => {
  /** tick 동안 버튼 상태를 그대로 유지한 뒤의 tick. */
  const run = (game: FloorGame, input: ButtonInput, from: number, ticks: number): number => {
    for (let t = from; t < from + ticks; t++) game.update(t, input.getState());
    return from + ticks;
  };

  it("⭐ 꾹 누르고 있어도 한 칸이다 — 뗐다 다시 눌러야 또 간다", () => {
    const pad = makePad();
    const game = new FloorGame();
    game.init(1, { index: 0, count: 1 });
    const start = game.getPosition();

    pad.press("right");
    let tick = run(game, pad.input, 0, 30); // 30tick 내내 누른 채
    const held = game.getPosition();
    expect(held.x).toBeGreaterThan(start.x);

    pad.release("right");
    tick = run(game, pad.input, tick, 5);
    pad.press("right"); // 다시 누르면 한 칸 더
    run(game, pad.input, tick, 5);
    expect(game.getPosition().x).toBeGreaterThan(held.x);
    expect(game.isPlayerDead()).toBe(false); // 아직 첫 물결 전이라 죽을 수 없다
  });

  it("버튼을 바꿔 누르면 그쪽으로 간다", () => {
    const pad = makePad();
    const game = new FloorGame();
    game.init(1, { index: 0, count: 1 });
    pad.press("down");
    let tick = run(game, pad.input, 0, 10);
    const down = game.getPosition();
    pad.release("down");
    pad.press("right");
    tick = run(game, pad.input, tick, 10);
    const right = game.getPosition();
    expect(right.y).toBe(down.y);
    expect(right.x).toBeGreaterThan(down.x);
  });
});

describe("조작 안내를 띄우는 조건", () => {
  it("손가락 기기에서 터치 조작이 있는 게임일 때만 띄운다", () => {
    expect(shouldShowHint(true, true)).toBe(true);
  });

  it("마우스 기기에서는 안 띄운다 — 방향키를 쓰는 사람에게 방해다", () => {
    expect(shouldShowHint(true, false)).toBe(false);
  });

  it("터치 조작이 없는 게임에서는 안 띄운다 — 눌러도 아무 일도 안 일어난다", () => {
    expect(shouldShowHint(false, true)).toBe(false);
    expect(shouldShowHint(false, false)).toBe(false);
  });
});

describe("입력 합성", () => {
  it("아무것도 안 눌리면 전부 false", () => {
    expect(mergeInputs([NONE, NONE])).toEqual(NONE);
  });

  it("키보드와 터치 중 하나만 눌려도 눌린 것이다", () => {
    expect(mergeInputs([of({ left: true }), NONE])).toEqual(of({ left: true }));
    expect(mergeInputs([NONE, of({ right: true })])).toEqual(of({ right: true }));
  });

  it("두 손가락이면 양쪽이 동시에 눌린다 — 게임이 판단할 몫이다", () => {
    expect(mergeInputs([of({ left: true }), of({ right: true })])).toEqual(of({ left: true, right: true }));
  });

  it("합성 결과는 새 객체다 — 소스의 내부 상태를 건드릴 수 없다", () => {
    const source = of({ up: true });
    const merged = mergeInputs([source]);
    merged.up = false;
    expect(source.up).toBe(true);
  });
});
