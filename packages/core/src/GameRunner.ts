/* ============================================================
   GameRunner — 코어가 구체 게임을 모른 채 게임을 구동하는 오케스트레이터
   ------------------------------------------------------------
   IGame · GameLoop · IRenderer · InputManager를 하나로 엮는다.
   여기서 "JungnimGame"이나 "화살" 같은 단어는 절대 등장하지 않는다.
   오직 IGame 인터페이스 메서드(init/update/render)만 호출한다.
   → IRepository로 데이터 계층을 추상화한 것과 동일한 의존성 역전.
   (DESIGN.md 3절: "GameRunner는 구체 게임을 모른다")

   결정론 불변식: 고정 스텝마다 update(tick, input)만 호출한다.
   입력은 스텝마다 새로 샘플링하되, 실측 deltaTime은 게임에 넘기지 않는다.
   ============================================================ */

import type { IGame, IRenderer } from "@arcade/shared";
import { GameLoop } from "./GameLoop";
import { InputManager } from "./input/InputManager";

export class GameRunner {
  private readonly loop: GameLoop;

  constructor(
    private readonly game: IGame,
    private readonly renderer: IRenderer,
    private readonly input: InputManager,
  ) {
    this.loop = new GameLoop(
      // 고정 스텝: 현재 입력 스냅샷과 tick만 게임에 전달.
      (tick) => this.game.update(tick, this.input.getState()),
      // 렌더: 보간 alpha만 전달(로직엔 영향 없음).
      (alpha) => this.game.render(this.renderer, alpha),
    );
  }

  /** 시드로 게임을 초기화하고 입력·루프를 시작한다. tick=0부터. */
  start(seed: number): void {
    this.game.init(seed);
    this.input.start();
    this.loop.resetTick();
    this.loop.start();
  }

  /** 루프와 입력 리스너를 멈춘다. */
  stop(): void {
    this.loop.stop();
    this.input.stop();
  }
}
