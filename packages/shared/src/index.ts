/* shared 패키지 진입점 — 공유 계약을 한 곳에서 export */

/** 결정론 난수. **엔진(core)이 아니라 계약(shared)에 둔다** — 게임이 이것 하나 때문에
 *  렌더러·웹소켓이 들어 있는 엔진 패키지에 묶이면 안 된다. 덕분에 게임의 의존은
 *  shared 하나뿐이고, "core는 게임을 모른다"의 짝인 "게임도 엔진을 모른다"가 성립한다. */
export { SeededRNG } from "./SeededRNG";

import type { ScoreUnit } from "./types";

export type { IGame } from "./IGame";
export type { IRenderer, TextAlign } from "./IRenderer";
export type {
  InputState,
  ScoreDirection,
  ScoreUnit,
  GaugeAlarm,
  RoomState,
  PlayerPublic,
  SpawnContext,
  SpectateSignal,
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

/** 기록 하나를 그 게임의 단위로 적는다. 순위표·결과표·개인 최고 기록·HUD가 전부
 *  같은 자리에 같은 숫자를 쓰므로, 단위를 각자 정하면 한 곳만 초로 남는다. */
export function formatScore(value: number, unit: ScoreUnit): string {
  return unit === "points" ? `${Math.round(value)}점` : formatTicks(value);
}
