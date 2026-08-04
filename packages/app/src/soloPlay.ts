/* ============================================================
   soloPlay — 혼자 플레이 한 판의 처음부터 끝까지
   ------------------------------------------------------------
   방도 상대도 없다. 사망·결과·재시작을 전부 로컬에서 처리하고, 게임 코드는
   멀티와 완전히 동일하다 — 결정론 코어가 시드만 다르게 돌 뿐이다.

   서버와는 딱 두 번, 그것도 **없어도 되는** 방식으로 만난다. 시작할 때 랭킹
   티켓을 받고(실패하면 로컬 시드로 그냥 논다), 죽으면 기록을 낸다(실패하면
   그냥 안 올라간다). 그래서 서버가 자고 있어도, 친구가 없어도 게임은 된다.

   여기 모아 둔 이유: 이 흐름은 **자기만의 상태**를 셋이나 들고 있다(미리 받은
   티켓 · 판 일련번호 · 시작 잠금). 전부 비동기 응답이 늦게 왔을 때 엉뚱한 판에
   끼어드는 걸 막는 장치라, 흐름과 붙어 있어야 읽힌다.
   ============================================================ */

import type { RankEntry } from "@arcade/shared";
import { formatTicks } from "@arcade/shared";
import type { AppEvent } from "./AppFlow";
import { renderResult, setAliveHud, toast } from "./AppView";
import { play } from "./audio";
import { runCountdown } from "./countdown";
import { byId } from "./dom";
import type { GameId } from "./GameRegistry";
import type { GameSession } from "./GameSession";
import { recordBest } from "./personalBest";
import { resetScreenFx, slideInScreen } from "./screenFx";
import { submitScore, takeTicket, type SoloTicket } from "./soloRanking";

/** 카운트다운 길이(ms). 멀티는 서버가 이 값으로 startTime을 잡고, 여기서는 로컬로 센다. */
const COUNTDOWN_MS = 3000;

/** 결과표에서 "나"를 가리키는 가짜 id. 서버가 준 실제 id와 절대 겹치지 않게 둔다. */
const SOLO_ID = "solo";

export type SoloPlayDeps = {
  session: GameSession;
  /** 상태 전이 시도. false면 그 사이 화면을 떠난 것이다. */
  transition: (event: AppEvent) => boolean;
  /** 아직 결과 화면인가. 늦게 온 순위 응답을 버릴지 판단한다. */
  isResultOpen: () => boolean;
  nickname: () => string;
  /** 판이 실제로 시작됐다(전이 성공). 앱이 모드 표시를 바꾼다. */
  onStarted: () => void;
  /** 이번 판의 결과표. 앱이 마지막 순위를 들고 있다가 다시 그릴 때 쓴다. */
  setRanks: (ranks: readonly RankEntry[]) => void;
  /** 게임 HUD 갱신(시간·게이지). 첫 프레임에 지난 판 숫자가 비치지 않게 미리 0으로 민다. */
  resetHud: () => void;
};

export type SoloPlay = {
  /** 곧 시작할 것 같은 시점에 티켓을 미리 받아 둔다(게임 선택·결과 화면). */
  prefetch: (gameId: GameId) => void;
  start: (gameId: GameId) => Promise<void>;
  /** 죽었다 — 결과창을 띄우고 기록을 낸다. */
  finish: (gameId: GameId | null, score: number) => void;
};

/** 라운드 시드. 게임 로직이 아니라 "시드 고르기"라 Math.random을 써도 결정론과 무관하다
 *  (서버도 같은 일을 한다). 이 시드가 정해진 뒤로는 모든 것이 시드와 tick에서만 파생된다.
 *  ⚠️ 이 시드로 시작한 판은 **순위표에 올라가지 않는다** — 서버가 발급하지 않은 판이라
 *     기록을 묶을 티켓이 없다. */
function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export function createSoloPlay(deps: SoloPlayDeps): SoloPlay {
  /** 미리 받아 둔 티켓. **버튼을 누른 뒤에** 서버를 왕복하면 그 시간만큼 판이 늦게 뜬다 —
   *  서버가 죽어 있을 때는 시간 초과를 다 기다려 2초 넘게 멈추는 게 실제로 측정됐다.
   *  안 쓴 티켓은 버려도 아무 비용이 없다 — 서버는 발급을 저장하지 않고, 쓴 티켓만 기억한다. */
  let pending: { gameId: GameId; promise: Promise<SoloTicket | null> } | null = null;
  /** 이번 판의 티켓. null이면 서버 없이 시작한 판이라 기록을 낼 수 없다. */
  let ticket: string | null = null;
  /** 판 일련번호. 늦게 도착한 순위 응답이 **다음 판** 결과창에 끼어드는 걸 막는다. */
  let round = 0;
  /** 티켓을 받는 동안 시작 버튼이 다시 눌리는 걸 막는다(왕복이 있어 즉시 시작이 아니다). */
  let starting = false;

  function prefetch(gameId: GameId): void {
    pending = { gameId, promise: takeTicket(gameId) };
  }

  /** 미리 받아 둔 게 있으면 그걸 쓰고, 없으면(다른 게임이거나 이미 썼으면) 지금 받는다. */
  function claim(gameId: GameId): Promise<SoloTicket | null> {
    const promise = pending?.gameId === gameId ? pending.promise : takeTicket(gameId);
    pending = null; // 티켓 하나로 한 판. 다음 판은 다시 받는다.
    return promise;
  }

  /** ⚠️ 기다리지 않는다. 결과창은 이미 떠 있고, 전체 등수는 도착하는 대로 뒤에 붙는다 —
   *  서버 응답 때문에 결과창이 늦게 뜨면 죽은 순간과 화면이 어긋난다. */
  function submit(score: number): void {
    const used = ticket;
    ticket = null; // 티켓은 일회용 — 같은 판에서 두 번 내지 않는다.
    const nickname = deps.nickname();
    if (!used || !nickname) return;

    const mine = round;
    void (async () => {
      const result = await submitScore(used, nickname, score);
      // 늦게 왔다. 그새 다음 판이 시작했으면 지금 결과창은 남의 판 것이다.
      if (!result || result.rank === null || mine !== round) return;
      if (!deps.isResultOpen()) return;
      byId("result-sub").textContent += ` · 전체 ${result.rank}위`;
    })();
  }

  return {
    prefetch,

    async start(gameId) {
      if (starting) return;
      // 랭킹 도전 판의 시드는 서버가 준다 — 그래야 기록이 이 한 판에 묶이고, 쉬운 시드가
      // 나올 때까지 다시 뽑을 수 없다. 서버가 자고 있으면 짧게 포기하고 로컬 시드로 논다.
      starting = true;
      const issued = await claim(gameId);
      starting = false;

      if (!deps.transition("start_solo")) return; // → countdown (기다리는 사이 떠났을 수 있다)
      ticket = issued?.ticket ?? null;
      round++; // 지난 판의 늦은 순위 응답은 이 시점부터 무시된다.
      deps.onStarted();
      deps.session.setRoster([], null); // 남이 없다 → peer도, 관전 뷰도 없다.
      setAliveHud("혼자 플레이");

      const seed = issued?.seed ?? randomSeed();
      slideInScreen(); // 카운트다운 동안 게임판이 위에서 내려와 자리잡는다.
      deps.session.showReadyFrame(gameId, seed); // 내려오는 판에 경기장을 미리 그려둔다.
      // 서버가 없으므로 로컬시각으로 센다(멀티는 서버시각 — 재는 방법만 다르다).
      const from = performance.now();
      runCountdown(() => COUNTDOWN_MS - (performance.now() - from), () => {
        if (!deps.transition("countdown_done")) return;
        resetScreenFx(); // 새 라운드 — 떨어졌던 화면 복구.
        play("go");
        deps.resetHud();
        setAliveHud("혼자 플레이");
        if (!deps.session.start(gameId, seed, performance.now())) {
          toast(`게임을 시작할 수 없습니다: ${gameId}`);
        }
      });
    },

    /** ⚠️ 여기서는 결과음을 내지 않는다 — 사망 처리가 같은 프레임에 부르므로 사망음 위에
     *  겹친다. 혼자 플레이에서 판이 끝났다는 신호는 사망음 하나로 충분하다. */
    finish(gameId, score) {
      if (!deps.transition("game_over")) return;
      const ranks: readonly RankEntry[] = [
        { id: SOLO_ID, rank: 1, nickname: deps.nickname(), survivalTicks: score },
      ];
      deps.setRanks(ranks);
      // amHost=true로 넘겨 "다시 하기"를 보이게 한다(혼자 할 때는 언제나 내가 방장이다).
      renderResult(ranks, SOLO_ID, true, true);
      // 혼자 하면 순위(1위)가 의미 없다 — 그 자리에 개인 최고기록을 보여준다.
      if (gameId) {
        const { best, isNew } = recordBest(gameId, score);
        byId("result-sub").textContent = `${isNew ? "새 기록! " : ""}최고 ${formatTicks(best)}`;
      }
      submit(score);
      // 여기서 가장 흔한 다음 행동은 "다시 하기"다 — 결과를 보는 동안 다음 티켓을 받아 둔다.
      if (gameId) prefetch(gameId);
      setAliveHud("", true);
      deps.session.stopRound();
    },
  };
}
