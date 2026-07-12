/* ============================================================
   Canvas2DRenderer — IRenderer의 Canvas 2D 구현
   ------------------------------------------------------------
   나중에 PixiJS로 교체할 때, 이 파일만 PixiRenderer로 바꾸면 된다.
   게임 코드는 IRenderer에만 의존하므로 게임을 수정할 필요가 없다.
   ============================================================ */

import type { IRenderer } from "@arcade/shared";

export class Canvas2DRenderer implements IRenderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context를 얻을 수 없습니다");
    this.ctx = ctx;
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
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
}
