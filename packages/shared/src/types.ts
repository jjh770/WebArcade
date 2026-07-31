/* ============================================================
   공통 타입 정의
   ------------------------------------------------------------
   문자열 유니온 타입으로 오타를 컴파일 타임에 차단한다
   (방향·점수방향 등을 좁은 유니온으로 둔다).
   ============================================================ */

/** 방향키 입력 상태. 4방향 회피 게임 기준(잠정 — 회전 등 필요한 게임은 나중에 확장). */
export type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

/** 라운드 시작 시 이 클라의 신원 — 멀티에서 플레이어별로 스폰을 나눠 갖는 데 쓴다.
 *  솔로면 넘기지 않는다(그때 게임은 index 0, count 1처럼 단일 스폰을 쓴다).
 *  스폰이 고정인 게임(죽림고수)은 이 정보를 무시해도 된다. */
export type SpawnContext = {
  index: number; // 로스터 내 내 순번(0-based)
  count: number; // 방 인원 수(전원이 같은 값 → 같은 스폰 집합에서 각자 슬롯을 고른다)
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

/** 관전 렌더용 남의 상태 — 보간할 위치(게임 좌표계). syncPeers로 게임에 넘긴다.
 *  이건 앱→게임 내부 전달용이지 네트워크로 나가는 wire 타입이 아니다(그건 PeerSnapshot). */
export type PeerState = {
  id: string;
  x: number;
  y: number;
  label?: string; // 표시용 닉네임(관전 화면 이름표). 없으면 이름은 생략.
};

/** 서버가 10Hz로 묶어서 전달하는 관전용 위치. 판정에는 사용하지 않는다.
 *  ev가 있으면 그 사람이 방금 낸 게임 정의 시각 이벤트(한 번만 실려 온다). */
export type PeerSnapshot = {
  id: string;
  px: number;
  py: number;
  ev?: string;
};
