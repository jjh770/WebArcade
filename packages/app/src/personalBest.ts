/* ============================================================
   솔로 개인 최고기록 — localStorage에 게임별로 저장한다.
   ------------------------------------------------------------
   멀티는 서버 순위가 진실이라 여기 쓰지 않는다(자기신고 조작을 막으려면
   영구 랭킹은 서버가 쥐어야 한다 — DESIGN 10절). 이건 순전히 혼자 연습의
   "한 판 더" 동기용이다.

   값은 그 게임의 기록(getScore)이고 **단위는 게임이 정한다** — 회피 게임은 생존
   tick(60tick=1초), 숫자 야구는 점수다. 여기서는 크기 비교만 하므로 알 필요가 없고,
   화면에 붙일 때 formatGameScore가 단위를 정한다.

   localStorage가 없거나(사생활 보호 모드 등) 던지면 기록 없이 조용히 넘어간다.
   ============================================================ */

const PREFIX = "arcade:best:";

/** 이 게임의 저장된 최고 기록. 없거나 읽기 실패면 0. */
export function getBest(gameId: string): number {
  try {
    const raw = localStorage.getItem(PREFIX + gameId);
    const n = raw === null ? 0 : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** 이번 기록을 반영한다. 이전 최고를 넘으면 저장하고 isNew=true를 돌려준다. */
export function recordBest(gameId: string, score: number): { best: number; isNew: boolean } {
  const prev = getBest(gameId);
  if (score > prev) {
    try {
      localStorage.setItem(PREFIX + gameId, String(score));
    } catch {
      /* 저장 실패해도 이번 판 결과 표시는 계속된다. */
    }
    return { best: score, isNew: true };
  }
  return { best: prev, isNew: false };
}
