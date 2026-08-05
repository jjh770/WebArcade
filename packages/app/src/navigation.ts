/* ============================================================
   navigation — 헤더 내비와 주소(해시)
   ------------------------------------------------------------
   "어느 화면으로 갈 수 있는가"는 FSM(AppFlow)이 정한다. 여기서 정하는 것은
   그보다 바깥의 두 가지다.

   1) **방에 있는 동안은 읽을거리로 새지 않는다.** FSM만으로는 못 막는다 — 결과
      화면에서 순위표로 가는 길을 혼자 플레이용으로 열어 뒀는데, 그 길이 멀티에서도
      열려 있으면 남은 사람들의 다음 판 시작 신호를 놓친 채 방을 떠나게 된다.
   2) **순위 화면만 주소에 남긴다.** 링크로 보낼 수 있어야 해서다.
   ============================================================ */

import type { AppEvent, AppState } from "./AppFlow";
import { renderNotices, toast } from "./AppView";
import type { GameId } from "./GameRegistry";

/** 방에 있는 동안 다른 페이지로 가려 했을 때. 두 갈래(직접 차단·FSM 거부) 모두 같은 말이다. */
const IN_ROOM = "방을 나간 뒤 다른 페이지로 이동할 수 있습니다.";

export type NavDeps = {
  transition: (event: AppEvent) => boolean;
  /** 방에 있는가. */
  inRoom: () => boolean;
  /** 닉네임을 정했는가 — 게임 탭이 메인으로 갈지 이름 화면으로 갈지 갈린다. */
  named: () => boolean;
  /** 헤더로 순위표를 열 때 보여 줄 게임(마지막에 보던 것 → 고른 것 → 첫 게임). */
  rankingGame: () => GameId;
  showRanking: (gameId: GameId) => void;
};

/** 순위 화면만 주소에 남긴다. 방 코드 자동 참가(#ABCD)와는 글자가 겹치지 않고,
 *  replaceState라 뒤로 가기 기록을 더럽히지 않는다. */
export function syncRankingHash(state: AppState): void {
  const want = state === "ranking" ? "#ranking" : "";
  if (location.hash === want) return;
  history.replaceState(null, "", want || location.pathname + location.search);
}

/** 헤더의 `[data-nav]` 요소들을 잇고, 클릭 말고도 같은 길을 쓸 수 있게 둘을 돌려준다
 *  (주소로 들어온 사람을 순위표에 내려놓는 것도 헤더를 누른 것과 같은 길이어야 한다). */
export function bindNav(deps: NavDeps): {
  navTo: (target: string | undefined) => void;
  goRanking: (gameId: GameId) => void;
} {
  function navTo(target: string | undefined): void {
    const event: AppEvent = target === "notice" ? "nav_notice"
      : target === "about" ? "nav_about"
        : target === "community" ? "nav_community"
          : target === "ranking" ? "nav_ranking"
            : deps.named() ? "nav_game_main" : "nav_game_nickname";
    if (deps.inRoom() && target !== "game") return toast(IN_ROOM);
    if (target === "notice") renderNotices();
    if (!deps.transition(event)) return toast(IN_ROOM);
    // 화면이 실제로 열렸을 때만 불러온다 — 막힌 경우에는 부를 필요가 없다.
    if (target === "ranking") deps.showRanking(deps.rankingGame());
  }

  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      navTo(element.dataset.nav);
    });
  });

  return {
    navTo,
    /** 특정 게임의 순위표로 곧장 간다(로비·결과 화면의 곁길). 헤더 내비와 달리
     *  **보던 게임을 지정**한다 — 방금 한 판의 순위가 궁금한 것이지 지난번에 본
     *  게임의 순위가 궁금한 게 아니다. */
    goRanking: (gameId) => {
      if (!deps.transition("nav_ranking")) return;
      deps.showRanking(gameId);
    },
  };
}
