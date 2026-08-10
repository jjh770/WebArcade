/* ============================================================
   IRenderer — 렌더러 추상 계약
   ------------------------------------------------------------
   게임은 이 인터페이스에만 의존하고 Canvas 2D API를 직접 부르지 않는다.
   나중에 PixiJS(WebGL)로 교체할 때 이 구현만 갈아끼우면 된다.
   ============================================================ */

/** 글자를 x의 **어느 쪽에** 놓는가. 기본은 left(x가 왼쪽 끝).
 *
 *  ⚠️ 이게 없던 동안 게임들은 중앙 정렬을 `cx - 90` 같은 상수로 눈대중했다. 글자 폭을
 *     잴 방법이 없어서인데, 그 상수는 **글자 수가 변하면 틀린다** — "사망 — 생존 9.9s"와
 *     "사망 — 생존 123.4s"가 서로 다른 만큼 어긋나 있었다. 폭을 아는 건 렌더러뿐이므로
 *     계산이 아니라 **의도**를 넘기게 한다.
 *  ⚠️ 폭을 직접 돌려주는 `measureText`는 **일부러 안 뒀다.** 지금 필요한 건 전부 정렬
 *     하나로 풀린다. 글자 뒤에 상자를 깔아야 하는 게임이 실제로 나오면 그때 연다. */
export type TextAlign = "left" | "center" | "right";

export interface IRenderer {
  clear(): void;
  circle(x: number, y: number, radius: number, color: string): void;
  rect(x: number, y: number, w: number, h: number, color: string): void;
  line(x1: number, y1: number, x2: number, y2: number, color: string, width?: number): void;
  text(content: string, x: number, y: number, color: string, size?: number, align?: TextAlign): void;
  /** 현재 뷰포트 크기. 관전 화면 분할(1+3 등) 레이아웃에 사용. */
  readonly width: number;
  readonly height: number;
}
