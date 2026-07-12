/* ============================================================
   앱 진입점
   ------------------------------------------------------------
   개발 순서 1단계(DESIGN.md 7절): 죽림고수 싱글의 기반.
   #game 캔버스 → Canvas2DRenderer → GAME_REGISTRY 팩토리로 게임 생성
   → GameRunner로 구동. 지금은 방/서버 없이 임시 시드로 바로 플레이.

   아직 만들지 않는 것(이후 단계): 닉네임·메뉴·로비·대기실·멀티.
   ============================================================ */

import { Canvas2DRenderer, GameRunner, InputManager } from "@arcade/core";
import { GAME_REGISTRY } from "./GameRegistry";

// 캔버스 크기(우선 800x600 고정). jungnimConfig.screenWidth/Height와 일치해야
// 플레이어 중앙 시작·경계 클램프가 화면과 맞는다. (반응형/게임별 크기 선언은 이후 단계)
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

// 방·서버 없이 검증하기 위한 임시 시드. 멀티 단계에서 서버의 game_start(seed)로 대체된다.
const TEMP_SEED = 12345;

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("#game 캔버스를 찾을 수 없습니다.");
}
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

const renderer = new Canvas2DRenderer(canvas);
const input = new InputManager();

// GameRegistry의 팩토리로 게임 생성 — main은 JungnimGame을 직접 new 하지 않는다.
const game = GAME_REGISTRY.jungnim.factory();

const runner = new GameRunner(game, renderer, input);
runner.start(TEMP_SEED);
