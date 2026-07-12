/* ============================================================
   죽림고수 config — 게임 메타데이터 (데이터로 분리)
   ------------------------------------------------------------
   친구(gahee) 코드의 content.ts 패턴 차용:
   게임 고유 설정을 코드가 아니라 데이터로 두어, 튜닝을 쉽게 한다.
   난이도 곡선 등을 여기서 조절하면 게임 로직은 안 건드려도 된다.
   ============================================================ */

import type { ScoreDirection } from "@arcade/shared";

export const jungnimConfig = {
  id: "jungnim",
  title: "죽림고수",
  description: "사방에서 날아오는 화살을 피해라",

  /** 순위 방향: 생존시간이 길수록 좋음. */
  scoreDirection: "higher" as ScoreDirection,

  /** 화면 크기(px). 플레이어 초기 위치·경계 클램프 기준. */
  screenWidth: 800,
  screenHeight: 600,

  /** 플레이어 이동 속도(px/tick). */
  playerSpeed: 3,

  /** 플레이어 히트박스 반지름. 실제보다 작게 두면 아슬아슬한 회피감(graze). */
  playerRadius: 6,

  /** 화살 속도(px/tick). */
  arrowSpeed: 4,

  /** 스폰 간격 곡선: 최소 간격과, tick당 얼마나 촘촘해지는지. */
  spawn: {
    baseIntervalTicks: 30,
    minIntervalTicks: 6,
    /** 난이도 1단계 오르는 데 걸리는 tick (difficulty = floor(tick / rampTicks)). */
    rampTicks: 300,
  },

  /** 화살 풀 초기 크기(오브젝트 풀링). */
  poolSize: 256,
} as const;

export type JungnimConfig = typeof jungnimConfig;
