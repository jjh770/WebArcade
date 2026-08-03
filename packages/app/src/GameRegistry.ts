/* ============================================================
   GameRegistry — 등록된 게임 목록 (단일 출처)
   ------------------------------------------------------------
   데이터 배열로 게임을 등록한다. 여기에 항목을 추가하면 게임 선택 화면이
   자동 반영된다(단순 표시 데이터가 아니라 factory까지 담아 "실행"한다).

   ⭐ 새 게임 추가 시 건드리는 파일은 사실상 이 파일 하나다.
      core는 한 줄도 바뀌지 않는다.
   ============================================================ */

import type { IGame, ScoreDirection } from "@arcade/shared";
import type { TouchScheme } from "./touchSchemes";
import { JungnimGame, jungnimConfig } from "@arcade/game-jungnim";
import { CurveGame, curveConfig } from "@arcade/game-curve";
import { FloorGame, floorConfig } from "@arcade/game-floor";

export type GameEntry = {
  id: string;
  title: string;
  description: string;
  scoreDirection: ScoreDirection;
  /** 게임 인스턴스를 만드는 팩토리 — 목록이 표시용이 아니라 실행용인 이유. */
  factory: () => IGame;
  /** 터치 조작 방식(touchSchemes.ts). 없으면 그 게임은 키보드 전용이다.
   *  조작은 게임마다 다르므로 core가 아니라 여기서 정한다
   *  (UI_DESIGN.md 경계: 게임별 UI 메타데이터는 GameRegistry에). */
  touch?: TouchScheme;
};

export const GAME_REGISTRY = {
  jungnim: {
    id: jungnimConfig.id,
    title: jungnimConfig.title,
    description: jungnimConfig.description,
    scoreDirection: jungnimConfig.scoreDirection,
    factory: () => new JungnimGame(),
    touch: "joystick",
  },
  curve: {
    id: curveConfig.id,
    title: curveConfig.title,
    description: curveConfig.description,
    scoreDirection: curveConfig.scoreDirection,
    factory: () => new CurveGame(),
    touch: "halves",
  },
  floor: {
    id: floorConfig.id,
    title: floorConfig.title,
    description: floorConfig.description,
    scoreDirection: floorConfig.scoreDirection,
    factory: () => new FloorGame(),
    // 격자를 한 칸씩 옮기므로 미는 위젯이 아니라 방향키 버튼(touchSchemes 참조).
    touch: "buttons",
  },
} satisfies Record<string, GameEntry>;

/** 등록된 게임 id의 유니온 타입. 문자열 유니온이라 존재하지 않는 게임 id를
 *  참조하면 컴파일 타임에 걸린다. */
export type GameId = keyof typeof GAME_REGISTRY;

export function isGameId(value: string): value is GameId {
  return value in GAME_REGISTRY;
}
