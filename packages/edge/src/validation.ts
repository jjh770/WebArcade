/* ============================================================
   validation — 클라 메시지 런타임 검증
   ------------------------------------------------------------
   서버는 게임 내용을 모르므로 **형식만** 본다. 내용의 옳고 그름은 판단하지 않는다.
   GAME_ID는 Worker의 방 생성 경로(POST /rooms)도 같은 규칙을 쓰므로 export한다.

   ⚠️ ROOM_CODE 정규식은 roomCode.ts의 문자 집합과 맞물려 있다. 한쪽만 바꾸면
      서버가 발급한 코드를 클라가 거부하는 조용한 버그가 된다(테스트로 고정).
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
