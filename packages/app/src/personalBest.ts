/* ============================================================
   솔로 개인 최고기록 — localStorage에 게임별로 저장한다.
   ------------------------------------------------------------
   멀티는 서버 순위가 진실이라 여기 쓰지 않는다(자기신고 조작을 막으려면
   영구 랭킹은 서버가 쥐어야 한다 — DESIGN 10절). 이건 순전히 혼자 연습의
   "한 판 더" 동기용이다. 값은 생존 tick(정수, 60tick=1초).

   localStorage가 없거나(사생활 보호 모드 등) 던지면 기록 없이 조용히 넘어간다.
   ============================================================ */

const PREFIX = "arcade:best:";

/** 이 게임의 저장된 최고 생존 tick. 없거나 읽기 실패면 0. */
export function getBest(gameId: string): number {
  try {
    const raw = localStorage.getItem(PREFIX + gameId);
    const n = raw === null ? 0 : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** 이번 점수를 반영한다. 이전 최고를 넘으면 저장하고 isNew=true를 돌려준다. */
export function recordBest(gameId: string, ticks: number): { best: number; isNew: boolean } {
  const prev = getBest(gameId);
  if (ticks > prev) {
    try {
      localStorage.setItem(PREFIX + gameId, String(ticks));
    } catch {
      /* 저장 실패해도 이번 판 결과 표시는 계속된다. */
    }
    return { best: ticks, isNew: true };
  }
  return { best: prev, isNew: false };
}
