import { describe, expect, it } from "vitest";
import type { AppState } from "../packages/app/src/AppFlow";
import { shortcutFor, type ShortcutContext } from "../packages/app/src/shortcuts";

/* 판 밖에서 눌린 키의 뜻. DOM을 모르는 순수 함수라 표처럼 시험한다 —
   실제로 누르는 것(리스너)은 main.ts 한 줄이고, 판단은 전부 여기에 있다. */

function context(overrides: Partial<ShortcutContext> = {}): ShortcutContext {
  return { state: "result", solo: true, repeat: false, buttonFocused: false, ...overrides };
}

describe("관전 중의 화살표", () => {
  const watching = context({ state: "spectating", solo: false });

  it("→는 다음, ←는 이전 — 대상 선택이 아니라 순환이라 방향만 있다", () => {
    expect(shortcutFor("ArrowRight", watching)).toEqual({ kind: "spectate", direction: 1 });
    expect(shortcutFor("ArrowLeft", watching)).toEqual({ kind: "spectate", direction: -1 });
  });

  it("혼자 플레이 여부와 무관하다 — 관전은 멀티에서만 일어나는 일이다", () => {
    expect(shortcutFor("ArrowRight", { ...watching, solo: true })).toEqual({ kind: "spectate", direction: 1 });
  });

  it("관전 중이 아니면 화살표는 아무 뜻도 없다", () => {
    expect(shortcutFor("ArrowRight", context({ state: "playing" }))).toBe(null);
    expect(shortcutFor("ArrowLeft", context({ state: "main" }))).toBe(null);
  });

  it("관전 중에는 Enter·Esc가 듣지 않는다 — 결과 화면의 키다", () => {
    expect(shortcutFor("Enter", watching)).toBe(null);
    expect(shortcutFor("Escape", watching)).toBe(null);
  });
});

describe("혼자 플레이 결과 화면의 Enter·Esc", () => {
  it("Enter는 다시 하기, Esc는 나가기", () => {
    expect(shortcutFor("Enter", context())).toEqual({ kind: "again" });
    expect(shortcutFor("Escape", context())).toEqual({ kind: "leave" });
  });

  it("멀티에서는 둘 다 듣지 않는다 — 남들까지 움직이는 버튼이다", () => {
    // 전원을 대기실로 돌리고 방을 나가는 일이라, 스치듯 누른 키로 일어나면 되돌릴 수 없다.
    expect(shortcutFor("Enter", context({ solo: false }))).toBe(null);
    expect(shortcutFor("Escape", context({ solo: false }))).toBe(null);
  });

  it("결과 화면이 아니면 듣지 않는다", () => {
    expect(shortcutFor("Enter", context({ state: "playing" }))).toBe(null);
    expect(shortcutFor("Escape", context({ state: "main" }))).toBe(null);
  });

  it("버튼에 초점이 있으면 Enter는 브라우저에 맡긴다 — 한 번이 두 판이 되면 안 된다", () => {
    expect(shortcutFor("Enter", context({ buttonFocused: true }))).toBe(null);
    // Esc는 초점이 있어도 브라우저가 하는 일이 없으므로 그대로 듣는다.
    expect(shortcutFor("Escape", context({ buttonFocused: true }))).toEqual({ kind: "leave" });
  });
});

describe("두 화면에 함께 걸리는 규칙", () => {
  it("눌린 채로 있는 키는 어느 쪽도 세지 않는다", () => {
    // 관전은 한 번 눌러 한 칸이어야 하고, 결과에서 세면 새 판이 프레임마다 다시 깔린다.
    expect(shortcutFor("ArrowRight", context({ state: "spectating", repeat: true }))).toBe(null);
    expect(shortcutFor("Enter", context({ repeat: true }))).toBe(null);
  });

  it("그 밖의 키는 어느 화면에서도 아무 뜻이 없다", () => {
    for (const state of ["spectating", "result", "main", "playing"] as const satisfies readonly AppState[]) {
      expect(shortcutFor(" ", context({ state }))).toBe(null);
      expect(shortcutFor("a", context({ state }))).toBe(null);
    }
  });
});
