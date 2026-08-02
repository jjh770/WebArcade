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
