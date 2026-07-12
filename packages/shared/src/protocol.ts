/* ============================================================
   네트워크 프로토콜 — 클라이언트와 서버가 공유하는 메시지 타입
   ------------------------------------------------------------
   이 파일을 클라/서버가 함께 import함으로써 "서버는 이 필드 보냈는데
   클라는 저 필드 기대"하는 실수를 컴파일 타임에 차단한다.
   서버는 게임 내용을 모른다 — gameId는 문자열로 중계할 뿐.
   ============================================================ */

import type { PlayerPublic } from "./types";

/** 클라이언트 → 서버 */
export type ClientMessage =
  | { type: "create_room"; gameId: string; nickname: string }
  | { type: "join_room"; code: string; nickname: string }
  | { type: "start_game" } // 호스트만 유효
  | { type: "player_died"; survivalTicks: number }
  | { type: "leave_room" };

/** 서버 → 클라이언트 */
export type ServerMessage =
  | { type: "welcome"; id: string } // 접속 직후 자기 id 통지(호스트 판별·자기 행 강조용)
  | { type: "room_state"; code: string; players: PlayerPublic[]; hostId: string }
  | { type: "game_start"; seed: number; startTime: number; gameId: string }
  | { type: "ranking_update"; alive: number; ranks: RankEntry[] }
  | { type: "game_over"; finalRanks: RankEntry[] }
  | { type: "host_changed"; newHostId: string }
  | { type: "error"; reason: string };

/** 순위표 한 줄 — 등수·닉네임·생존시간 (DESIGN.md 4절) */
export type RankEntry = {
  rank: number;
  nickname: string;
  survivalTicks: number;
};
