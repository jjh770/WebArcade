/* shared 패키지 진입점 — 공유 계약을 한 곳에서 export */

export type { IGame } from "./IGame";
export type { IRenderer } from "./IRenderer";
export type {
  InputState,
  ScoreDirection,
  RoomState,
  PlayerPublic,
  SpawnContext,
  SpectateTarget,
  PeerState,
  PeerSnapshot,
} from "./types";
export type {
  ClientMessage,
  ServerMessage,
  RankEntry,
} from "./protocol";

/** 결정론 불변식: 게임 로직은 이 고정 스텝만 사용한다.
 *  ⚠️ tick↔초 변환은 여기서만 나온다. 60을 각자 적어두면 스텝을 바꿀 때
 *  루프만 바뀌고 표시·디버프 지속시간은 옛 값으로 남는다. */
export const TICKS_PER_SECOND = 60;
export const FIXED_STEP_MS = 1000 / TICKS_PER_SECOND;

/** tick을 사람이 읽는 초 표기로. 기록·생존시간을 화면에 쓰는 곳이 여럿이라 여기 둔다. */
export function formatTicks(ticks: number): string {
  return `${(ticks / TICKS_PER_SECOND).toFixed(1)}s`;
}
