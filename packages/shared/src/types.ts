/* ============================================================
   공통 타입 정의
   ------------------------------------------------------------
   친구(gahee) 코드의 기법 차용: 문자열 유니온 타입으로 오타를
   컴파일 타임에 차단한다. (Platform 유니온 → 여기선 방향/점수방향 등)
   ============================================================ */

/** 방향키 입력 상태. 4방향 회피 게임 기준(잠정 — 회전 등 필요한 게임은 나중에 확장). */
export type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

/** 순위 정렬 방향. 죽림고수=생존시간이라 higher. 스피드런류는 lower.
 *  DESIGN.md의 "getScore 우열 방향" 미정 항목을 이 타입으로 해소한다. */
export type ScoreDirection = "higher" | "lower";

/** 서버와 앱이 공유하는 방 수명주기. 게임별 상태가 아니라 멀티 방의 공통 상태다. */
export type RoomState = "waiting" | "countdown" | "playing" | "finished";

/** 플레이어 공개 상태 — 네트워크로 오가는 최소 정보. */
export type PlayerPublic = {
  id: string;
  nickname: string;
  alive: boolean;
  survivalTicks: number;
};

/** 관전 대상 — 남의 화면을 그릴 때 필요한 정보(위치는 게임 좌표계).
 *  id는 원격 플레이어의 시각 요소(syncPeers로 넘긴 아바타)를 찾는 키. */
export type SpectateTarget = {
  id: string;
  x: number;
  y: number;
  label: string;
};

/** 관전 렌더용 남의 상태 — 보간할 위치(게임 좌표계). syncPeers로 게임에 넘긴다. */
export type PeerState = {
  id: string;
  x: number;
  y: number;
};

/** 서버가 10Hz로 묶어서 전달하는 관전용 위치. 판정에는 사용하지 않는다. */
export type PeerSnapshot = {
  id: string;
  px: number;
  py: number;
};
