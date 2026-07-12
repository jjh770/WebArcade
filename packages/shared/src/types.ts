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

/** 플레이어 공개 상태 — 네트워크로 오가는 최소 정보. */
export type PlayerPublic = {
  id: string;
  nickname: string;
  alive: boolean;
  survivalTicks: number;
};
