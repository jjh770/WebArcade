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

  /** 화살 길이(px) — 렌더용 화살촉~꼬리 길이. */
  arrowLength: 16,

  /** 화살 히트박스 반지름(px). playerRadius와 합쳐 원-원 충돌 판정. */
  arrowRadius: 3,

  /** 스폰 간격 곡선: 최소 간격과, tick당 얼마나 촘촘해지는지.
   *  패턴이 여러 발을 한꺼번에 쏘므로(벽·수렴 등) 간격에 숨 쉴 틈을 둔다. */
  spawn: {
    baseIntervalTicks: 45,
    minIntervalTicks: 15,
    /** 난이도 1단계 오르는 데 걸리는 tick (difficulty = floor(tick / rampTicks)). */
    rampTicks: 360,
  },

  /** 화살 패턴 튜닝. 전부 시드/tick에서만 파생된다 — 플레이어 위치는 절대 참조 안 함.
   *  (참조하면 클라마다 화살이 달라져 결정론이 깨진다.) */
  pattern: {
    /** single 패턴 화살의 각도 흔들림(도). */
    angleJitterDeg: 10,
    /** spread(부채꼴): 한 지점에서 count발을 totalDeg 각도 안에 펼친다. */
    spread: { count: 5, totalDeg: 55 },
    /** wall(벽): 한 변을 count칸으로 나눠 채우되 gap칸을 안전지대로 비운다. */
    wall: { count: 12, gap: 3 },
    /** converge(수렴): 화면 중앙 ±지터 지점을 향해 사방에서 count발. */
    converge: { count: 6, aimJitterPx: 90 },
    /** 각 패턴이 열리는 난이도 문턱(difficulty >= 값이면 후보에 포함). */
    unlock: { spread: 1, wall: 2, converge: 3 },
  },

  /** 개인(플레이어 조준) 화살 레이어 — 공통과 분리된 난수 스트림.
   *  ⚠️ 전부 (개인 시드 + tick + 플레이어 위치)에서만 파생 → Math.random 없음.
   *  덕분에 관전자도 위치 스트림만 있으면 그대로 재구성할 수 있다(남들도 봄). */
  personal: {
    /** 이 tick 이후부터 개인 화살 등장(초반 유예). */
    unlockTick: 300,
    /** 스폰 이벤트 간격(tick). */
    intervalTicks: 30,
    /** 개인 화살 속도(px/tick). 공통 arrowSpeed와 달리 둬 체감 구분. */
    speed: 3.5,
    /** 한 패턴을 몇 번 연속 발사한 뒤 다른 패턴으로 바꿀지(페이즈 길이). */
    phaseSpawns: 9,
    /** 스피너: 매 발사마다 각도를 stepDeg만큼 돌려 가장자리에서 플레이어를 조준. */
    spinner: { stepDeg: 40 },
    /** 링: 플레이어를 중심으로 사방 count방향에서 동시에 조여든다. */
    ring: { count: 8 },
    /** 각 개인 패턴이 열리는 tick 문턱(aimed는 unlockTick부터 항상). */
    unlock: { spinner: 300, ring: 900 },
  },

  /** 관전 시 남의 위치를 부드럽게 따라가는 계수(틱당 lerp, 0~1).
   *  위치가 ~10Hz로 드문드문 오므로, 매 틱 이 비율로 목표에 다가가 점·화살이
   *  뚝뚝 끊기지 않고 매끄럽게 움직인다. 크면 즉각적이지만 덜 부드럽다. */
  spectateSmoothing: 0.25,

  /** 화살 풀 초기 크기(오브젝트 풀링). */
  poolSize: 256,
} as const;

export type JungnimConfig = typeof jungnimConfig;
