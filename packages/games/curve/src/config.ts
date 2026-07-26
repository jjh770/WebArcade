/* ============================================================
   커브 피버 config — 게임 튜닝값을 데이터로 분리
   ------------------------------------------------------------
   죽림고수와 같은 패턴(config.ts). 로직은 안 건드리고 여기서 조절한다.

   게임 규칙: 계속 앞으로 나아가는 선을 좌/우 회전만으로 조종한다.
   지나온 자리에 꼬리가 남고, 아무 꼬리(내 것이든 남의 것이든)나 벽에
   부딪히면 죽는다. 마지막 생존자가 승리.
   ============================================================ */

import type { ScoreDirection } from "@arcade/shared";

export const curveConfig = {
  id: "curve",
  title: "커브 피버",
  description: "좌우로 꺾어 선을 그린다. 꼬리에 부딪히면 죽는다",

  /** 순위 방향: 오래 살아남을수록 좋음(생존 tick). 죽림고수와 같다. */
  scoreDirection: "higher" as ScoreDirection,

  /** 화면(캔버스) 논리 크기(px). app의 LOGICAL_WIDTH/HEIGHT와 일치시킬 것. */
  screenWidth: 800,
  screenHeight: 800,

  /** 벽 여백(px). 이 안쪽이 플레이 가능 영역 — 벽에 닿으면 죽는다. */
  wallMargin: 20,

  /** 전진 속도(px/tick). 곡선이 부드럽도록 회전각과 함께 맞춘다. */
  speed: 2,

  /** 한 tick에 도는 각도(라디안). 좌/우 입력이 있을 때만 적용.
   *  작으면 완만한 대회전, 크면 급회전. 0.05 ≈ 2.9도/tick. */
  turnRate: 0.05,

  /** 선 두께(px) = 충돌 판정 반경의 2배. 굵을수록 부딪히기 쉽다. */
  lineWidth: 4,

  /** 충돌 면제 구간(최근 N개 꼬리점). 이게 없으면 자기 머리 바로 뒤 꼬리에
   *  매 tick 부딪혀 즉사한다 — 머리와 가장 가까운 꼬리는 원래 붙어 있으니까. */
  selfImmuneTrailPoints: 12,

  /** 시작 시 벽에서 띄우는 최소 거리(px). 스폰 직후 벽에 처박히지 않게. */
  spawnInset: 120,
} as const;

export type CurveConfig = typeof curveConfig;
