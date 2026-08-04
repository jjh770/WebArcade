/* ============================================================
   rankingScreen — 순위 화면의 내용을 채운다
   ------------------------------------------------------------
   화면 전이(언제 열 수 있는가)는 부르는 쪽 몫이고, 여기서는 **연 뒤에 무엇을
   보여줄지**만 맡는다. 자기 상태는 "마지막으로 보던 게임" 하나뿐이다.

   ⚠️ 목록은 캐시하지 않는다. 남이 방금 세운 기록이 안 보이는 것보다, 열 때마다
      한 번 더 묻는 쪽이 낫다.
   ============================================================ */

import { renderRanking, renderRankingTabs } from "./AppView";
import type { GameId } from "./GameRegistry";
import { fetchBoard } from "./soloRanking";

export type RankingScreenDeps = {
  /** 아직 순위 화면인가. 늦게 도착한 목록을 버릴지 판단한다. */
  isOpen: () => boolean;
  /** 내 줄을 강조하려고 쓴다. 입장 전이면 빈 문자열이다. */
  nickname: () => string;
};

export type RankingScreen = {
  /** 마지막으로 본 게임. 헤더 내비로 다시 열 때 그 자리로 돌아간다. */
  lastViewed: () => GameId | null;
  /** 이 게임의 순위표를 그린다(불러오는 중 → 목록 또는 실패). */
  show: (gameId: GameId) => void;
};

export function createRankingScreen(deps: RankingScreenDeps): RankingScreen {
  let current: GameId | null = null;

  async function load(gameId: GameId): Promise<void> {
    current = gameId;
    renderRankingTabs(gameId, (id) => void load(id));
    renderRanking({ state: "loading" }, deps.nickname(), gameId);
    const rows = await fetchBoard(gameId);
    // 기다리는 사이 다른 탭을 눌렀거나 화면을 떠났다 — 지금 화면은 이 목록의 자리가 아니다.
    if (current !== gameId || !deps.isOpen()) return;
    renderRanking(rows ? { state: "ready", rows } : { state: "failed" }, deps.nickname(), gameId);
  }

  return {
    lastViewed: () => current,
    show: (gameId) => void load(gameId),
  };
}
