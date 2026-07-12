/* ============================================================
   GameRegistry — 등록된 게임 목록 (단일 출처)
   ------------------------------------------------------------
   친구(gahee) 코드의 content.ts `games` 배열 패턴 차용:
   여기에 항목을 추가하면 게임 선택 화면이 자동 반영된다.
   차이점: 친구 건 "보여줄 데이터", 이건 "실행할 게임"(factory 포함).

   ⭐ 새 게임 추가 시 건드리는 파일은 사실상 이 파일 하나다.
      core는 한 줄도 바뀌지 않는다.
   ============================================================ */

import type { IGame, ScoreDirection } from "@arcade/shared";
import { JungnimGame, jungnimConfig } from "@arcade/game-jungnim";

export type GameEntry = {
  id: string;
  title: string;
  description: string;
  scoreDirection: ScoreDirection;
  /** 게임 인스턴스를 만드는 팩토리 — 친구 코드엔 없는, 실행 중심 요소. */
  factory: () => IGame;
};

export const GAME_REGISTRY = {
  jungnim: {
    id: jungnimConfig.id,
    title: jungnimConfig.title,
    description: jungnimConfig.description,
    scoreDirection: jungnimConfig.scoreDirection,
    factory: () => new JungnimGame(),
  },
  // 두 번째 게임은 여기에 추가:
  // tetris: { id: "tetris", title: "...", ..., factory: () => new TetrisGame() },
} satisfies Record<string, GameEntry>;

/** 등록된 게임 id의 유니온 타입 — 친구의 Platform 유니온 기법 차용.
 *  존재하지 않는 게임 id를 참조하면 컴파일 타임에 걸린다. */
export type GameId = keyof typeof GAME_REGISTRY;

/** 게임 선택 화면용 목록 (자동 생성). */
export const gameList: GameEntry[] = Object.values(GAME_REGISTRY);
