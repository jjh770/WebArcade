/* ============================================================
   validation — 클라 메시지 검증 (packages/server/src/validation.ts에서 이식)
   ------------------------------------------------------------
   서버는 게임 내용을 모르므로 **형식만** 본다. 내용의 옳고 그름은 판단하지 않는다.
   ⚠️ 이식 중에는 원본도 살아 있어 같은 규칙이 두 벌 있다. 한쪽만 고치면 갈라진다.

   원본과 다른 점: GAME_ID를 export한다(Worker의 방 생성 경로도 같은 규칙을 쓴다).
   ============================================================ */

import type { ClientMessage } from "@arcade/shared";

const ROOM_CODE = /^[A-HJ-NP-Z]{4}$/;
export const GAME_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isNickname = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length >= 1 && [...value.trim()].length <= 12;

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "create_room":
      return GAME_ID.test(String(value.gameId ?? "")) && isNickname(value.nickname)
        ? { type: value.type, gameId: String(value.gameId), nickname: value.nickname.trim() }
        : null;
    case "join_room":
      return ROOM_CODE.test(String(value.code ?? "")) && isNickname(value.nickname)
        ? { type: value.type, code: String(value.code), nickname: value.nickname.trim() }
        : null;
    case "time_sync_request":
      return typeof value.requestId === "string" && value.requestId.length >= 1 && value.requestId.length <= 64
        ? { type: value.type, requestId: value.requestId }
        : null;
    case "player_state":
      return isFiniteNumber(value.px) && isFiniteNumber(value.py)
        ? { type: value.type, px: value.px, py: value.py }
        : null;
    case "player_died":
      return Number.isSafeInteger(value.survivalTicks) && Number(value.survivalTicks) >= 0
        ? { type: value.type, survivalTicks: Number(value.survivalTicks) }
        : null;
    case "start_game":
    case "return_to_ready":
    case "leave_room":
      return { type: value.type };
    default:
      return null;
  }
}
