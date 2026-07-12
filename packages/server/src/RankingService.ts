/* ============================================================
   RankingService — 순위 계산 (서버는 게임을 모른다)
   ------------------------------------------------------------
   서버가 아는 건 "누가 얼마나 오래 버텼나(survivalTicks)"뿐.
   화살·판정은 클라 로컬이고, 서버는 생존시간만 모아 순서를 매긴다.

   정렬 규칙: 살아있는 사람(승자)이 먼저, 그다음 생존시간 긴 순.
   (죽림고수는 "오래 버틸수록 좋음" — scoreDirection 'higher'. 다른 게임의
   우열 방향은 클라 표기 문제이고, 서버는 생존시간 내림차순만 안다.)
   ============================================================ */

import type { RankEntry } from "@arcade/shared";
import type { Member } from "./Room";

export class RankingService {
  static computeRanks(members: readonly Member[]): RankEntry[] {
    const sorted = [...members].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1; // 생존자 먼저
      return b.survivalTicks - a.survivalTicks; // 오래 버틴 순
    });
    return sorted.map((m, i) => ({
      rank: i + 1,
      nickname: m.nickname,
      survivalTicks: m.survivalTicks,
    }));
  }

  static aliveCount(members: readonly Member[]): number {
    return members.reduce((n, m) => n + (m.alive ? 1 : 0), 0);
  }
}
