/* shared 패키지 진입점 — 공유 계약을 한 곳에서 export */

export type { IGame } from "./IGame";
export type { IRenderer } from "./IRenderer";
export type { InputState, ScoreDirection, PlayerPublic, SpectateTarget, PeerState } from "./types";
export type {
  ClientMessage,
  ServerMessage,
  RankEntry,
} from "./protocol";

/** 결정론 불변식: 게임 로직은 이 고정 스텝만 사용한다. */
export const FIXED_STEP_MS = 1000 / 60;
