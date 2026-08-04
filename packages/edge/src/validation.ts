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
/** 방해 효과 종류 식별자. 서버는 의미를 모르므로 형식(짧은 슬러그)만 본다. */
const EFFECT_KIND = /^[a-z0-9_-]{1,32}$/;
/** 방해 효과 지속시간 상한(ms). 무한·비상식적 값으로 상대를 마비시키는 걸 막는다. */
const MAX_EFFECT_MS = 10000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** 혼자 기록 제출(BoardObject)도 같은 규칙을 쓴다 — 대기실에서 통과한 이름이
 *  순위표에서는 거부되는 엇갈림을 막으려면 한 군데서만 정해야 한다. */
export const isNickname = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length >= 1 && [...value.trim()].length <= 12;
/** 플레이어 id 형식(서버가 crypto.randomUUID로 발급). 실제 존재 여부는 라우팅에서 확인. */
const isPlayerId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 64;

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
    case "player_state": {
      // ev는 게임 정의 시각 이벤트 슬러그. 서버는 의미를 모르므로 형식만 본다(없어도 정상).
      if (!isFiniteNumber(value.px) || !isFiniteNumber(value.py)) return null;
      // sc(지금까지의 기록)도 형식만 본다 — 이게 초인지 점수인지는 게임이 아는 일이다.
      // ⚠️ 형식이 틀리면 메시지를 버리지 않고 **sc만 뺀다.** 위치는 10Hz로 오는 관전
      //    정보라, 한 필드 때문에 통째로 버리면 남의 화면에서 그 사람이 얼어붙는다.
      const sc = Number.isSafeInteger(value.sc) && Number(value.sc) >= 0 ? Number(value.sc) : undefined;
      const ev = value.ev === undefined ? undefined : EFFECT_KIND.test(String(value.ev)) ? String(value.ev) : null;
      if (ev === null) return null;
      const base = { type: value.type, px: value.px, py: value.py };
      return { ...base, ...(ev === undefined ? {} : { ev }), ...(sc === undefined ? {} : { sc }) };
    }
    case "player_died":
      return Number.isSafeInteger(value.survivalTicks) && Number(value.survivalTicks) >= 0
        ? { type: value.type, survivalTicks: Number(value.survivalTicks) }
        : null;
    case "fire_effect":
      // 서버는 효과의 의미를 모른다 — kind는 짧은 식별자 문자열, durationMs는 상한만,
      // targetId는 형식(서버 발급 id)만 본다. 그 id가 실제 방 멤버인지는 라우팅에서 거른다.
      return EFFECT_KIND.test(String(value.kind ?? "")) &&
        isFiniteNumber(value.durationMs) &&
        value.durationMs > 0 &&
        value.durationMs <= MAX_EFFECT_MS &&
        isPlayerId(value.targetId)
        ? { type: value.type, kind: String(value.kind), durationMs: value.durationMs, targetId: String(value.targetId) }
        : null;
    case "start_game":
    case "return_to_ready":
    case "leave_room":
      return { type: value.type };
    default:
      return null;
  }
}
