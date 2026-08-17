/* ============================================================
   GameRegistry — 등록된 게임 목록 (단일 출처)
   ------------------------------------------------------------
   데이터 배열로 게임을 등록한다. 여기에 항목을 추가하면 게임 선택 화면이
   자동 반영된다(단순 표시 데이터가 아니라 factory까지 담아 "실행"한다).

   ⭐ 새 게임 추가 시 건드리는 파일은 대개 이 파일 하나다 — 앞의 셋(회피 게임)이 그랬고,
      **core는 한 줄도 바뀌지 않았다.**
   ⚠️ 다만 "하나뿐"은 아니다. 넷째(숫자 야구)는 방향이 아니라 글자를 받는 게임이라
      계약(IGame.typeKey)과 조작면(keypad)까지 넓혀야 했다. 기존 조작·기존 기록 방식을
      쓰는 게임이면 여기 한 줄, 그렇지 않으면 그 새로움만큼 바깥이 열린다.
   ============================================================ */

import type { GaugeAlarm, IGame, ScoreDirection, ScoreUnit } from "@arcade/shared";
import { formatScore } from "@arcade/shared";
import type { TouchScheme } from "./touchSchemes";
import type { TrackId } from "./bgm";
import { JungnimGame, jungnimConfig } from "@arcade/game-jungnim";
import { CurveGame, curveConfig } from "@arcade/game-curve";
import { FloorGame, floorConfig } from "@arcade/game-floor";
import { BaseballGame, baseballConfig } from "@arcade/game-baseball";
import { AimGame, aimConfig } from "@arcade/game-aim";
import { ShootGame, shootConfig } from "@arcade/game-shoot";

export type GameEntry = {
  id: string;
  title: string;
  description: string;
  scoreDirection: ScoreDirection;
  /** getScore가 무엇을 돌려주는가 — 화면이 초로 쓸지 점으로 쓸지 정한다. */
  scoreUnit: ScoreUnit;
  /** HUD 게이지 이름. getGauge를 구현한 게임만 갖는다(없으면 게이지 줄이 안 뜬다). */
  gaugeLabel?: string;
  /** 게이지 경고색이 붙는 쪽(가득/비어감). 게임마다 게이지의 뜻이 반대라 필요하다. */
  gaugeAlarm?: GaugeAlarm;
  /** 게임 인스턴스를 만드는 팩토리 — 목록이 표시용이 아니라 실행용인 이유. */
  factory: () => IGame;
  /** 터치 조작 방식(touchSchemes.ts). 없으면 그 게임은 키보드 전용이다.
   *  조작은 게임마다 다르므로 core가 아니라 여기서 정한다
   *  (UI_DESIGN.md 경계: 게임별 UI 메타데이터는 GameRegistry에). */
  touch?: TouchScheme;
  /** 판이 도는 동안 흐르는 곡(bgm.ts). 없으면 로비 곡이 그대로 이어진다.
   *  ⚠️ 게임 config가 아니라 여기다 — 게임 패키지는 `public/bgm/`도 앱의 화면 구성도
   *     몰라야 한다. 어느 게임에 어떤 곡이 어울리는가는 판정이 아니라 연출 결정이다. */
  bgm?: TrackId;
};

export const GAME_REGISTRY = {
  jungnim: {
    id: jungnimConfig.id,
    title: jungnimConfig.title,
    description: jungnimConfig.description,
    scoreDirection: jungnimConfig.scoreDirection,
    scoreUnit: jungnimConfig.scoreUnit,
    factory: () => new JungnimGame(),
    touch: "joystick",
    // 사방에서 화살이 쏟아진다 — 몰아치는 곡.
    bgm: "assault",
  },
  curve: {
    id: curveConfig.id,
    title: curveConfig.title,
    description: curveConfig.description,
    scoreDirection: curveConfig.scoreDirection,
    scoreUnit: curveConfig.scoreUnit,
    gaugeLabel: curveConfig.gaugeLabel,
    gaugeAlarm: curveConfig.gaugeAlarm,
    factory: () => new CurveGame(),
    touch: "halves",
    // 멈추지 않고 계속 달리는 게임.
    bgm: "escape_from_metal_city",
  },
  floor: {
    id: floorConfig.id,
    title: floorConfig.title,
    description: floorConfig.description,
    scoreDirection: floorConfig.scoreDirection,
    scoreUnit: floorConfig.scoreUnit,
    factory: () => new FloorGame(),
    // 격자를 한 칸씩 옮기므로 미는 위젯이 아니라 방향키 버튼(touchSchemes 참조).
    touch: "buttons",
    // 발밑이 계속 바뀌는 게임.
    bgm: "midnight_drive",
  },
  baseball: {
    id: baseballConfig.id,
    title: baseballConfig.title,
    description: baseballConfig.description,
    scoreDirection: baseballConfig.scoreDirection,
    scoreUnit: baseballConfig.scoreUnit,
    gaugeLabel: baseballConfig.gaugeLabel,
    gaugeAlarm: baseballConfig.gaugeAlarm,
    factory: () => new BaseballGame(),
    // 방향이 아니라 숫자를 받으므로 앞의 세 방식이 하나도 맞지 않는다 — 화면 숫자판이
    // 곧 조작이다. 이 게임에서는 조작면이 "있으면 편한 것"이 아니라 없으면 못 논다.
    touch: "keypad",
    // 넷 중 유일하게 앉아서 생각하는 게임 — 몰아붙이지 않는 곡.
    bgm: "blue_intermission",
  },
  aim: {
    id: aimConfig.id,
    title: aimConfig.title,
    description: aimConfig.description,
    scoreDirection: aimConfig.scoreDirection,
    scoreUnit: aimConfig.scoreUnit,
    gaugeLabel: aimConfig.gaugeLabel,
    gaugeAlarm: aimConfig.gaugeAlarm,
    factory: () => new AimGame(),
    // 판을 짚은 자리가 곧 조준점이다. 위젯도 버튼도 없는 유일한 방식 —
    // 조준을 위젯으로 옮기면 겨누는 손과 보는 눈이 갈라진다.
    touch: "aim",
    // 이 게임을 위해 새로 들여온 곡(2026-08-17). 몰아붙이지 않고 멀리 퍼지는 결이라
    // 45초 내내 한 점을 좇는 일과 부딪히지 않는다.
    bgm: "observing_the_star",
  },
  shoot: {
    id: shootConfig.id,
    title: shootConfig.title,
    description: shootConfig.description,
    scoreDirection: shootConfig.scoreDirection,
    scoreUnit: shootConfig.scoreUnit,
    gaugeLabel: shootConfig.gaugeLabel,
    gaugeAlarm: shootConfig.gaugeAlarm,
    factory: () => new ShootGame(),
    touch: "aim",
    // 형제 게임과 **같은 곡**이다(2026-08-17 사용자 결정). 둘을 이어서 해도 곡이 안 갈리는데,
    // 결이 같은 두 게임이라 그게 어색하지 않다.
    bgm: "observing_the_star",
  },
} satisfies Record<string, GameEntry>;

/** 계약(GameEntry)으로 넓혀 꺼낸다. 레지스트리는 satisfies라 항목마다 리터럴 타입이고,
 *  그래서 어떤 항목에만 있는 선택 필드(gaugeLabel 등)는 유니온에서 안 보인다. */
export function gameEntry(id: GameId): GameEntry {
  return GAME_REGISTRY[id];
}

/** 기록 하나를 그 게임의 단위로 적는다. 순위표·결과표·개인 최고 기록·HUD가 전부
 *  이걸 부른다 — 한 곳만 formatTicks로 남으면 숫자 야구 점수가 "4.0s"로 찍힌다. */
export function formatGameScore(gameId: GameId | null, value: number): string {
  return formatScore(value, gameId ? GAME_REGISTRY[gameId].scoreUnit : "ticks");
}

/** 등록된 게임 id의 유니온 타입. 문자열 유니온이라 존재하지 않는 게임 id를
 *  참조하면 컴파일 타임에 걸린다. */
export type GameId = keyof typeof GAME_REGISTRY;

export function isGameId(value: string): value is GameId {
  return value in GAME_REGISTRY;
}
