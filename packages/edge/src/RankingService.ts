/* ============================================================
   RankingService — 순위 계산 (서버는 게임을 모른다)
   ------------------------------------------------------------
   서버가 아는 건 "누가 어떤 기록을 냈나(finalScore)"뿐. 화살·판정은 클라 로컬이고,
   서버는 그 숫자만 모아 순서를 매긴다.

   ⚠️ 그 숫자가 **무엇인지 모른다** — 생존 tick일 수도 점수일 수도 있다. 여기서는
      크기만 비교하므로 알 필요도 없다. 단위(ScoreUnit)는 앱이 표시할 때 붙인다.

   정렬 규칙: 살아있는 사람(승자)이 먼저, 그다음 기록이 큰 순.
   (네 게임 모두 scoreDirection이 'higher'다. 낮을수록 좋은 게임이 생기면 그때는
   방향을 서버가 알아야 하므로 이 정렬을 다시 봐야 한다.)
   ============================================================ */

import type { RankEntry } from "@arcade/shared";
import type { Member } from "./Room";

export class RankingService {
  static computeRanks(members: readonly Member[]): RankEntry[] {
    const sorted = [...members].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1; // 생존자 먼저
      return b.finalScore - a.finalScore; // 기록이 큰 순
    });
    return sorted.map((m, i) => ({
      id: m.id,
      rank: i + 1,
      nickname: m.nickname,
      score: m.finalScore,
    }));
  }

  static aliveCount(members: readonly Member[]): number {
    return members.reduce((n, m) => n + (m.alive ? 1 : 0), 0);
  }
}
