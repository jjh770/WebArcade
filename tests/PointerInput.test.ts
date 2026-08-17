/* 조준 좌표 계산(PointerInput).

   리스너·포인터 캡처는 브라우저에서 확인한다. 여기서 잡는 건 **판 밖과 크기 0**이다.
   둘 다 조용히 어긋나는 종류다 — 판 밖은 조준점이 세계 밖으로 나가고, 크기 0은
   NaN이 게임까지 흘러들어 화면에서 조준점이 통째로 사라진다. */
import { describe, expect, it } from "vitest";
import { normalizeInBox, type PointerBox } from "../packages/core/src/input/PointerInput";

const BOX: PointerBox = { left: 100, top: 50, width: 400, height: 200 };

describe("normalizeInBox", () => {
  it("상자 안의 점을 0~1로 옮긴다", () => {
    expect(normalizeInBox(BOX, 100, 50)).toEqual({ nx: 0, ny: 0 });
    expect(normalizeInBox(BOX, 500, 250)).toEqual({ nx: 1, ny: 1 });
    expect(normalizeInBox(BOX, 300, 150)).toEqual({ nx: 0.5, ny: 0.5 });
  });

  it("상자 밖은 버리지 않고 가장자리에 붙인다", () => {
    // 마우스가 판을 벗어나도 조준은 벽에 붙어 기다린다(사라지지 않는다).
    expect(normalizeInBox(BOX, -1000, 150)).toEqual({ nx: 0, ny: 0.5 });
    expect(normalizeInBox(BOX, 9999, 150)).toEqual({ nx: 1, ny: 0.5 });
    expect(normalizeInBox(BOX, 300, -1)).toEqual({ nx: 0.5, ny: 0 });
    expect(normalizeInBox(BOX, 300, 9999)).toEqual({ nx: 0.5, ny: 1 });
  });

  it("크기가 없는 판에서는 아무 좌표도 내지 않는다", () => {
    expect(normalizeInBox({ left: 0, top: 0, width: 0, height: 200 }, 10, 10)).toBeNull();
    expect(normalizeInBox({ left: 0, top: 0, width: 400, height: 0 }, 10, 10)).toBeNull();
  });

  it("두 축을 따로 잰다 — 판이 정사각형이 아니어도 어긋나지 않는다", () => {
    // 가로 400 · 세로 200인 판에서 같은 픽셀만큼 움직인 값은 서로 달라야 한다.
    expect(normalizeInBox(BOX, 200, 150)).toEqual({ nx: 0.25, ny: 0.5 });
  });
});
