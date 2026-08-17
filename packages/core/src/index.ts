/* core 패키지 진입점 — 엔진. 게임을 모른다. */

export { GameLoop } from "./GameLoop";
export { GameRunner, type GameView } from "./GameRunner";
export { InputManager } from "./input/InputManager";
export { CompositeInput, mergeInputs, type InputSource } from "./input/InputSource";
export { TouchInput, splitLeftRight, joystick8, type TouchMapper } from "./input/TouchInput";
export { ButtonInput, type Direction, type DirectionButton } from "./input/ButtonInput";
export { KeyEntry, keyToSlug } from "./input/KeyEntry";
export { PointerInput, normalizeInBox, type PointerBox } from "./input/PointerInput";
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
