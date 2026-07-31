/* ============================================================
   목록 stagger — 순수 계산부
   ------------------------------------------------------------
   장식이지만 "대기실은 새로 들어온 사람만 움직인다"는 규칙은 정보 전달이다.
   목록 전체가 매번 흔들리면 누가 들어왔는지 못 읽는다(UI_MOTION.md 대기실).
   ============================================================ */

import { describe, it, expect } from "vitest";
import { newcomers, staggerIndex, STAGGER_MAX_INDEX } from "../packages/app/src/stagger";

describe("목록 stagger", () => {
  it("처음 그리는 목록은 전부 새 사람이다", () => {
    expect(newcomers(new Set(), ["a", "b", "c"])).toEqual(new Set(["a", "b", "c"]));
  });

  it("이미 있던 사람은 다시 애니메이션하지 않는다", () => {
    expect(newcomers(new Set(["a", "b"]), ["a", "b", "c"])).toEqual(new Set(["c"]));
  });

  it("순서가 바뀌어도 새 사람은 아니다", () => {
    expect(newcomers(new Set(["a", "b"]), ["b", "a"])).toEqual(new Set());
  });

  it("나갔다 다시 들어오면 새 사람으로 친다", () => {
    // 호출자가 매 렌더마다 현재 목록으로 previous를 갈아끼우므로 나간 사람은 잊힌다.
    const afterLeave = new Set(["a"]); // b가 나간 뒤의 상태
    expect(newcomers(afterLeave, ["a", "b"])).toEqual(new Set(["b"]));
  });

  it("뒤쪽 행은 상한에서 멈춘다 — 인원이 늘어도 마지막이 한참 뒤에 뜨지 않는다", () => {
    expect(staggerIndex(0)).toBe(0);
    expect(staggerIndex(3)).toBe(3);
    expect(staggerIndex(19)).toBe(STAGGER_MAX_INDEX);
  });
});
