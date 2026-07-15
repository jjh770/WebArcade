import { describe, expect, it } from "vitest";
import type { IRenderer, InputState } from "@arcade/shared";
import { JungnimGame } from "../packages/games/jungnim/src/JungnimGame";

const IDLE: InputState = { up: false, down: false, left: false, right: false };
const MOVE_RIGHT: InputState = { up: false, down: false, left: false, right: true };

class CaptureRenderer implements IRenderer {
  readonly width = 800;
  readonly height = 800;
  readonly commonLines: number[][] = [];
  clear(): void {}
  circle(): void {}
  rect(): void {}
  text(): void {}
  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
    if (color === "#1d3557") this.commonLines.push([x1, y1, x2, y2, width]);
  }
}

function simulate(game: JungnimGame, seed: number, input: InputState): number[][] {
  game.init(seed);
  for (let tick = 0; tick < 1200; tick++) game.update(tick, input);
  const renderer = new CaptureRenderer();
  game.render(renderer, 0);
  return renderer.commonLines;
}

describe("죽림고수 결정론", () => {
  it("로컬 입력이 달라도 공통 화살은 동일하다", () => {
    const left = simulate(new JungnimGame(), 123456, IDLE);
    const right = simulate(new JungnimGame(), 123456, MOVE_RIGHT);
    expect(left.length).toBeGreaterThan(0);
    expect(right).toEqual(left);
  });

  it("같은 인스턴스를 같은 시드로 초기화하면 동일한 월드를 재생한다", () => {
    const game = new JungnimGame();
    const first = simulate(game, 777, IDLE);
    const second = simulate(game, 777, IDLE);
    expect(second).toEqual(first);
  });
});
