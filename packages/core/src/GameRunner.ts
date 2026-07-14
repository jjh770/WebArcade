/* ============================================================
   GameRunner — 코어가 구체 게임을 모른 채 게임을 구동하는 오케스트레이터
   ------------------------------------------------------------
   IGame · GameLoop · IRenderer · InputManager를 하나로 엮는다.
   여기서 "JungnimGame"이나 "화살" 같은 단어는 절대 등장하지 않는다.
   오직 IGame 인터페이스 메서드(init/update/render/renderSpectator)만 호출한다.

   결정론 불변식: 고정 스텝마다 update(tick, input)만 호출한다.
   입력은 스텝마다 새로 샘플링하되, 실측 deltaTime은 게임에 넘기지 않는다.

   멀티 뷰: 한 게임(공통 월드는 하나)을 여러 화면에 그릴 수 있다.
   메인(자기/관전) + 사이드(생존자들)를 매 프레임 각자 렌더한다.
   ============================================================ */

import type { IGame, IRenderer, SpectateTarget } from "@arcade/shared";
import { GameLoop } from "./GameLoop";
import { InputManager } from "./input/InputManager";

/** 한 화면(뷰). target=null이면 자기 화면(render), 있으면 그 대상(남) 관전(renderSpectator). */
export type GameView = { renderer: IRenderer; target: SpectateTarget | null };

export class GameRunner {
  private readonly loop: GameLoop;
  /** 이번 판에서 사망 콜백을 이미 쐈는지(한 번만 발화). */
  private deathReported = false;
  /** 그릴 화면 목록. 보통 [0]=메인(자기/관전), 나머지=사이드(생존자들). */
  private views: GameView[] = [];

  constructor(
    private readonly game: IGame,
    private readonly input: InputManager,
    /** 로컬 사망이 처음 감지된 순간 한 번 호출(멀티에서 player_died 전송용).
     *  게임이 뭔지는 모른다 — IGame.isPlayerDead()만 관찰. */
    private readonly onDeath?: () => void,
  ) {
    this.loop = new GameLoop(
      // 고정 스텝: 현재 입력 스냅샷과 tick만 게임에 전달.
      (tick) => {
        this.game.update(tick, this.input.getState());
        if (!this.deathReported && this.game.isPlayerDead()) {
          this.deathReported = true;
          this.onDeath?.();
        }
      },
      // 렌더: 각 뷰마다 자기 화면(render) 또는 관전(renderSpectator).
      (alpha) => {
        for (const v of this.views) {
          if (v.target) this.game.renderSpectator(v.renderer, v.target);
          else this.game.render(v.renderer, alpha);
        }
      },
    );
  }

  /** 그릴 화면 목록 설정. 앱이 레이아웃(메인+사이드)에 맞춰 넘긴다.
   *  게임이 뭔지는 모른다 — IGame.render/renderSpectator만 각 renderer에 호출. */
  setViews(views: GameView[]): void {
    this.views = views;
  }

  /** 시드로 게임을 초기화하고 입력·루프를 시작한다. tick=0부터. */
  start(seed: number): void {
    this.game.init(seed);
    this.deathReported = false;
    this.input.start();
    this.loop.resetTick();
    this.loop.start();
  }

  /** 새 시드로 다음 판을 시작한다. 루프·입력 리스너는 유지한 채 tick만 0으로.
   *  (게임오버 → 다시 시작 한 바퀴. 어떤 게임인지는 여전히 모른다 — IGame.init만 호출) */
  restart(seed: number): void {
    this.game.init(seed);
    this.deathReported = false;
    this.loop.resetTick();
  }

  /** 현재 게임이 로컬 사망 판정을 냈는지 위임. 앱이 재시작 시점을 정하는 데 쓴다. */
  isPlayerDead(): boolean {
    return this.game.isPlayerDead();
  }

  /** 루프와 입력 리스너를 멈춘다. */
  stop(): void {
    this.loop.stop();
    this.input.stop();
  }
}
