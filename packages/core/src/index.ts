/* core 패키지 진입점 — 엔진. 게임을 모른다. */

export { SeededRNG } from "./SeededRNG";
export { GameLoop } from "./GameLoop";
export { GameRunner, type GameView } from "./GameRunner";
export { InputManager } from "./input/InputManager";
export { NetClient } from "./net/NetClient";
export { Canvas2DRenderer } from "./render/Canvas2DRenderer";
export { StateMachine, type TransitionTable, type StateTransition } from "./StateMachine";
export {
  selectBestClockAnchor,
  serverNowFromAnchor,
  serverTimeToPerformance,
  type ClockAnchor,
  type ClockSample,
} from "./ClockSync";
