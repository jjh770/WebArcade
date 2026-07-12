/* core 패키지 진입점 — 엔진. 게임을 모른다. */

export { SeededRNG } from "./SeededRNG";
export { GameLoop } from "./GameLoop";
export { GameRunner } from "./GameRunner";
export { InputManager } from "./input/InputManager";
export { NetClient } from "./net/NetClient";
export { Canvas2DRenderer } from "./render/Canvas2DRenderer";
// GameStateMachine는 앱 플로우 단계에서 추가
