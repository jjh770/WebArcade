/* Canvas2DRenderer — 글자 정렬이 실제로 캔버스까지 닿는가.

   왜 테스트가 필요한가: 캔버스 ctx는 **상태를 들고 있다.** 한 번 textAlign을 center로
   두면 그다음 호출도 계속 center다. 정렬을 쓰는 곳이 화면당 한둘뿐이라, 새어 나가도
   "저 글자가 왜 저기 있지" 정도로만 보이고 원인을 찾기 어렵다. 그리는 순서에 따라
   조용히 어긋나는 종류의 버그라 눈으로는 못 잡는다. */
import { describe, expect, it } from "vitest";
import { Canvas2DRenderer } from "../packages/core/src/render/Canvas2DRenderer";

/** fillText가 불릴 때의 ctx 상태를 그대로 찍어 두는 가짜 2D 컨텍스트. */
function fakeCanvas() {
  const calls: { content: string; x: number; align: string; font: string }[] = [];
  const ctx = {
    fillStyle: "",
    font: "",
    textAlign: "left",
    fillText(content: string, x: number, _y: number) {
      calls.push({ content, x, align: ctx.textAlign, font: ctx.font });
    },
    setTransform() {},
  };
  const canvas = { width: 800, height: 800, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe("글자 정렬", () => {
  it("기본은 left — 정렬을 안 넘긴 기존 호출은 그대로 동작한다", () => {
    const { canvas, calls } = fakeCanvas();
    new Canvas2DRenderer(canvas, 800, 800).text("관전: 고수", 12, 28, "#fff", 22);
    expect(calls[0]).toMatchObject({ x: 12, align: "left" });
  });

  it("center·right가 그대로 전달된다", () => {
    const { canvas, calls } = fakeCanvas();
    const r = new Canvas2DRenderer(canvas, 800, 800);
    r.text("사망", 400, 400, "#fff", 26, "center");
    r.text("240점", 780, 60, "#fff", 24, "right");
    expect(calls.map((c) => c.align)).toEqual(["center", "right"]);
  });

  it("⭐ 정렬이 다음 호출로 새지 않는다 — ctx는 상태를 들고 있다", () => {
    const { canvas, calls } = fakeCanvas();
    const r = new Canvas2DRenderer(canvas, 800, 800);
    r.text("가운데", 400, 400, "#fff", 26, "center");
    r.text("왼쪽", 12, 28, "#fff", 22); // 정렬을 안 넘겼다 = left여야 한다
    expect(calls[1]!.align).toBe("left");
  });
});
