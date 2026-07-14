/* ============================================================
   Canvas2DRenderer — IRenderer의 Canvas 2D 구현
   ------------------------------------------------------------
   나중에 PixiJS로 교체할 때, 이 파일만 PixiRenderer로 바꾸면 된다.
   게임 코드는 IRenderer에만 의존하므로 게임을 수정할 필요가 없다.

   좌표계 분리(반응형):
   - 게임은 항상 "논리 좌표"(예: 800x600)로만 그린다. 화면이 얼마나 크든 작든
     게임 코드는 이 사실을 모른다 — 결정론 좌표계는 절대 안 흔들린다.
   - 실제 캔버스 픽셀(백킹스토어)은 CSS 크기 x devicePixelRatio다.
   - 둘 사이는 ctx 변환행렬이 잇는다. resize()가 그 행렬을 다시 세운다.
   ============================================================ */

import type { IRenderer } from "@arcade/shared";

export class Canvas2DRenderer implements IRenderer {
  private ctx: CanvasRenderingContext2D;

  /** 게임이 그리는 좌표계 크기. 화면 크기와 무관하게 고정된다. */
  constructor(
    private canvas: HTMLCanvasElement,
    private readonly logicalWidth: number = canvas.width,
    private readonly logicalHeight: number = canvas.height,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context를 얻을 수 없습니다");
    this.ctx = ctx;
    this.applyTransform();
  }

  get width(): number {
    return this.logicalWidth;
  }

  get height(): number {
    return this.logicalHeight;
  }

  /** 표시 크기(CSS px)에 맞춰 백킹스토어를 DPR만큼 키우고, 논리->픽셀 변환행렬을 다시 세운다.
   *
   *  ⚠️ 소유권 분리: 캔버스의 **표시 크기는 건드리지 않는다**(CSS/레이아웃의 몫).
   *  여기서 style.width를 쓰면 인라인 스타일이 CSS를 덮어써 반응형 확대가 잠긴다.
   *  렌더러는 "지금 이만큼 보이고 있다"는 사실을 받아 해상도만 맞춘다. 렌더 전용 — 결정론 무관. */
  resize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.applyTransform(); // canvas.width 대입은 변환행렬을 초기화하므로 항상 다시 세운다.
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
  }

  circle(x: number, y: number, radius: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
  }

  text(content: string, x: number, y: number, color: string, size = 16): void {
    this.ctx.fillStyle = color;
    this.ctx.font = `${size}px sans-serif`;
    this.ctx.fillText(content, x, y);
  }

  /** 논리 좌표 -> 백킹스토어 픽셀 스케일. 선 굵기·글자 크기도 함께 스케일된다. */
  private applyTransform(): void {
    const sx = this.canvas.width / this.logicalWidth;
    const sy = this.canvas.height / this.logicalHeight;
    this.ctx.setTransform(sx, 0, 0, sy, 0, 0);
  }
}
