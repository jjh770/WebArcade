/* ============================================================
   GameRunner — 코어가 구체 게임을 모른 채 게임을 구동하는 오케스트레이터
   ------------------------------------------------------------
   IGame · GameLoop · IRenderer · InputManager를 하나로 엮는다.
   구체 게임 이름이나 게임 오브젝트 개념 없이 IGame 계약만 호출한다.

   결정론 불변식: 고정 스텝마다 update(tick, input)만 호출한다.
   입력은 스텝마다 새로 샘플링하되, 실측 deltaTime은 게임에 넘기지 않는다.

   멀티 뷰: 한 게임(공통 월드는 하나)을 여러 화면에 그릴 수 있다.
   메인(자기/관전) + 사이드(생존자들)를 매 프레임 각자 렌더한다.
   ============================================================ */

import type { IGame, IRenderer, SpectateTarget, SpawnContext } from "@arcade/shared";
import { GameLoop } from "./GameLoop";
import type { InputSource } from "./input/InputSource";

/** 한 화면(뷰). target=null이면 자기 화면(render), 있으면 그 대상(남) 관전(renderSpectator). */
export type GameView = { renderer: IRenderer; target: SpectateTarget | null };

export class GameRunner {
  private readonly loop: GameLoop;
  /** 이번 판에서 사망 콜백을 이미 쐈는지(한 번만 발화). */
  private deathReported = false;
  /** 그릴 화면 목록. 보통 [0]=메인(자기/관전), 나머지=사이드(생존자들). */
  private views: GameView[] = [];
  /** 이번 프레임에 모인 소리 슬러그. Set인 이유: 한 프레임에 고정 스텝이 여러 번 돌 수
   *  있어(따라잡기), 같은 소리가 0ms 간격으로 겹쳐 나면 그냥 커지기만 한다. */
  private readonly frameSounds = new Set<string>();

  constructor(
    private readonly game: IGame,
    /** 키보드든 터치든 InputState를 내는 것이면 된다 — 러너는 출처를 모른다. */
    private readonly input: InputSource,
    /** 로컬 사망이 처음 감지된 순간 한 번 호출(멀티에서 player_died 전송용).
     *  게임이 뭔지는 모른다 — IGame.isPlayerDead()만 관찰. */
    private readonly onDeath?: () => void,
    /** 매 렌더 프레임마다 로컬 플레이어 HUD 값을 앱에 흘려보낸다(캔버스 밖 DOM 헤더용).
     *  score=getScore(생존 tick), gauge=getGauge()가 있으면 그 값(0~1) 없으면 null.
     *  게임이 뭔지는 모른다 — HUD 표시는 앱이 정한다. */
    private readonly onHud?: (score: number, gauge: number | null) => void,
    /** 게임이 발사를 냈을 때 걸 수 있는 디버프 풀을 앱에 넘긴다(멀티에서 fire_effect 전송용).
     *  이 중 하나를 뽑아 누구에게 보낼지는 앱이 정한다 — 러너는 슬러그 의미를 모른다. */
    private readonly onFire?: (debuffs: readonly { kind: string; durationMs: number }[]) => void,
    /** 이번 프레임에 게임이 낸 소리 슬러그들을 앱에 넘긴다(앱이 실제 소리에 대응시킨다).
     *  러너는 슬러그의 뜻을 모른다 — 모으고 중복만 없앤다. */
    private readonly onSound?: (slugs: readonly string[]) => void,
  ) {
    this.loop = new GameLoop(
      // 고정 스텝: 현재 입력 스냅샷과 tick만 게임에 전달.
      (tick) => {
        this.game.update(tick, this.input.getState());
        if (!this.deathReported && this.game.isPlayerDead()) {
          this.deathReported = true;
          this.onDeath?.();
        }
        // 이번 스텝에 발사가 있으면 디버프 풀을 앱으로 흘려보낸다(앱이 하나 뽑아 조준 전송).
        const fire = this.game.consumePendingFire?.();
        if (fire && fire.length > 0) this.onFire?.(fire);
        // 소리는 여기서 흘려보내지 않고 모은다 — 스텝마다 내보내면 따라잡기 프레임에서
        // 같은 소리가 여러 번 겹친다. 프레임당 한 번, 렌더 때 비운다.
        const sounds = this.game.consumeSounds?.();
        if (sounds) for (const slug of sounds) this.frameSounds.add(slug);
      },
      // 렌더: 각 뷰마다 자기 화면(render) 또는 관전(renderSpectator).
      (alpha) => {
        for (const v of this.views) {
          if (v.target) this.game.renderSpectator(v.renderer, v.target);
          else this.game.render(v.renderer, alpha);
        }
        this.onHud?.(this.game.getScore(), this.game.getGauge?.() ?? null);
        if (this.frameSounds.size > 0) {
          this.onSound?.([...this.frameSounds]);
          this.frameSounds.clear();
        }
      },
    );
  }

  /** 그릴 화면 목록 설정. 앱이 레이아웃(메인+사이드)에 맞춰 넘긴다.
   *  게임이 뭔지는 모른다 — IGame.render/renderSpectator만 각 renderer에 호출. */
  setViews(views: GameView[]): void {
    this.views = views;
  }

  /** 루프를 돌리지 않고 시드 초기 상태를 현재 뷰에 한 번만 그린다.
   *  카운트다운 동안 "빈 경기장 + 중앙 플레이어"를 미리 보여주는 용도.
   *  이후 start()가 같은 시드로 다시 init하므로 결정론엔 영향 없다. */
  prime(seed: number, self?: SpawnContext): void {
    this.game.init(seed, self);
    this.deathReported = false;
    for (const v of this.views) {
      if (v.target) this.game.renderSpectator(v.renderer, v.target);
      else this.game.render(v.renderer, 0);
    }
  }

  /** 시드와 예약 epoch로 라운드를 완전히 새로 시작한다. 반복 호출에도 리스너가 중복되지 않는다. */
  start(seed: number, startEpochPerformanceMs = performance.now(), self?: SpawnContext): void {
    this.loop.stop();
    this.game.init(seed, self);
    this.deathReported = false;
    this.frameSounds.clear(); // 지난 판의 소리가 새 판 첫 프레임에 새어 나오지 않게.
    this.input.start();
    this.loop.resetTick(startEpochPerformanceMs);
    this.loop.start();
  }

  /** 현재 게임이 로컬 사망 판정을 냈는지 위임. 앱이 재시작 시점을 정하는 데 쓴다. */
  isPlayerDead(): boolean {
    return this.game.isPlayerDead();
  }

  /** 글자 입력이 들어왔을 때 앱이 호출(키보드든 화면 자판이든). 게임이 글자를
   *  받는 게임이면 그대로 넘긴다 — 러너는 슬러그의 뜻을 모른다.
   *  ⚠️ 고정 스텝 밖에서 곧장 넘긴다. 다음 스텝까지 모아 두면 빠르게 친 글자가
   *  한 tick씩 밀리는데, 로컬 입력이라 결정론과 무관하니 미룰 이유가 없다. */
  typeKey(key: string): void {
    this.game.typeKey?.(key);
  }

  /** 조준점이 움직였을 때 앱이 호출(마우스든 손가락이든). 좌표는 판 기준 0~1이고,
   *  러너는 그게 무엇을 겨누는지 모른다 — IGame.aim에 그대로 위임한다.
   *  ⚠️ typeKey와 같은 이유로 고정 스텝 밖에서 곧장 넘긴다. 다음 스텝까지 모아 두면
   *  조준점이 한 tick씩 늦게 따라오는데, 그건 겨누는 사람 손에 바로 잡힌다. */
  aim(nx: number, ny: number): void {
    this.game.aim?.(nx, ny);
  }

  /** 조준점 자리를 쏘았을 때 앱이 호출. aim과 마찬가지로 러너는 뜻을 모른다.
   *  ⚠️ 부르는 쪽이 aim을 먼저 부른다(PointerInput의 계약) — 여기서 순서를 다시 세우지 않는다. */
  fire(nx: number, ny: number): void {
    this.game.fire?.(nx, ny);
  }

  /** 시선이 돌아갔을 때 앱이 호출(마우스 움직임). 러너는 뜻을 모른다 — IGame.look에 위임. */
  look(dnx: number, dny: number): void {
    this.game.look?.(dnx, dny);
  }

  /** 남의 발사에 맞았을 때 앱이 호출. 게임이 아는 효과면 로컬에 적용한다.
   *  게임이 뭔지는 모른다 — IGame.applyEffect에 그대로 위임. */
  applyEffect(kind: string, durationMs: number): void {
    this.game.applyEffect?.(kind, durationMs);
  }

  /** 루프와 입력 리스너를 멈춘다. */
  stop(): void {
    this.loop.stop();
    this.input.stop();
  }
}
