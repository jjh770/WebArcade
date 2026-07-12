/* ============================================================
   IRenderer — 렌더러 추상 계약
   ------------------------------------------------------------
   게임은 이 인터페이스에만 의존하고 Canvas 2D API를 직접 부르지 않는다.
   나중에 PixiJS(WebGL)로 교체할 때 이 구현만 갈아끼우면 된다.
   (정종혁 님의 IRepository → IRenderer로 이어지는 추상화 일관성)
   ============================================================ */

export interface IRenderer {
  clear(): void;
  circle(x: number, y: number, radius: number, color: string): void;
  rect(x: number, y: number, w: number, h: number, color: string): void;
  line(x1: number, y1: number, x2: number, y2: number, color: string, width?: number): void;
  text(content: string, x: number, y: number, color: string, size?: number): void;
  /** 현재 뷰포트 크기. 관전 화면 분할(1+3 등) 레이아웃에 사용. */
  readonly width: number;
  readonly height: number;
}
