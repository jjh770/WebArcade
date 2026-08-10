/* ============================================================
   네트워크 프로토콜 — 클라이언트와 서버가 공유하는 메시지 타입
   ------------------------------------------------------------
   이 파일을 클라/서버가 함께 import함으로써 "서버는 이 필드 보냈는데
   클라는 저 필드 기대"하는 실수를 컴파일 타임에 차단한다.
   서버는 게임 내용을 모른다 — gameId는 문자열로 중계할 뿐.
   ============================================================ */

import type { PeerSnapshot, PlayerPublic, RoomState } from "./types";

/** 클라이언트 → 서버 */
export type ClientMessage =
  | { type: "create_room"; gameId: string; nickname: string }
  | { type: "join_room"; code: string; nickname: string }
  | { type: "start_game" } // 호스트만 유효
  | { type: "return_to_ready" } // 종료 후 호스트만 유효
  | { type: "time_sync_request"; requestId: string }
  // 관전용 위치(주기적). 서버가 최신값을 방 스냅샷으로 묶는다.
  // ev는 그 순간 남들 화면에도 보여야 할 **게임 정의 시각 이벤트** 슬러그(예: 죽림고수 "purge").
  // 서버는 의미를 모르고 다음 스냅샷에 한 번 실어 보낸 뒤 지운다. 위치에 얹어 보내므로
  // 새 메시지 종류·새 주기가 필요 없다(이벤트는 늘 그 사람 위치에서 일어난다).
  // sc는 **지금까지의 기록**(getScore). 끊긴 사람의 최종 기록을 서버가 지어내지 않게
  // 하려고 함께 흘려보낸다 — 서버는 이 숫자가 tick인지 점수인지 모르고, 저장했다가
  // 연결이 끊기면 그때 마지막 값을 그대로 쓴다. 위치와 같은 주기라 새 메시지가 필요 없다.
  | { type: "player_state"; px: number; py: number; ev?: string; sc?: number }
  // score는 **그 게임의 기록**(getScore). 앞의 세 게임은 생존 tick이고 숫자 야구는 점수다 —
  // 서버는 어느 쪽인지 모르고 방향도 모른 채 그대로 받아 순위에만 쓴다(단위는 앱이 붙인다).
  | { type: "player_died"; score: number }
  | { type: "fire_effect"; kind: string; durationMs: number; targetId: string } // 스릴 게이지 발사 — 조준한 상대 1명에게만 방해 효과. 서버는 내용 모르고 그 1명에게 중계.
  | { type: "leave_room" };

/** 서버 → 클라이언트 */
export type ServerMessage =
  | { type: "welcome"; id: string } // 접속 직후 자기 id 통지(호스트 판별·자기 행 강조용)
  | { type: "room_state"; code: string; gameId: string; state: RoomState; players: PlayerPublic[]; hostId: string }
  | { type: "game_start"; seed: number; startTime: number; gameId: string }
  | { type: "time_sync_response"; requestId: string; serverTime: number }
  | { type: "peer_snapshot"; peers: PeerSnapshot[] } // 관전 위치를 방 단위로 일괄 전달
  | { type: "peer_died"; id: string } // 남이 죽음(관전 대상 교체 신호)
  | { type: "effect_hit"; from: string; kind: string; durationMs: number } // 누군가의 발사에 맞음(방해 효과 적용). 서버는 kind를 그대로 중계.
  | { type: "ranking_update"; alive: number; ranks: RankEntry[] }
  | { type: "game_over"; finalRanks: RankEntry[] }
  | { type: "host_changed"; newHostId: string }
  | { type: "error"; reason: string };

/** 순위표 한 줄 — 등수·닉네임·기록 (DESIGN.md 4절)
 *  ⚠️ score의 **단위는 여기 없다.** 게임마다 tick이거나 점수이고(ScoreUnit), 그걸 아는 건
 *     앱의 GameRegistry뿐이다. 서버는 이 숫자를 크기로만 다룬다. */
export type RankEntry = {
  id: string;
  rank: number;
  nickname: string;
  score: number;
};
