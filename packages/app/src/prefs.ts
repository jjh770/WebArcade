/* ============================================================
   사용자 로컬 설정 — localStorage에 저장하는 자잘한 선호값.
   ------------------------------------------------------------
   지금은 닉네임 하나. 매번 다시 입력하지 않게 마지막에 쓴 이름을 기억한다.
   localStorage가 없거나 던지면(사생활 보호 모드 등) 조용히 넘어간다.
   (게임별 최고기록은 성격이 달라 personalBest.ts에 따로 둔다.)
   ============================================================ */

const NICK_KEY = "arcade:nickname";

/** 마지막에 쓴 닉네임. 없거나 읽기 실패면 빈 문자열. */
export function loadNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? "";
  } catch {
    return "";
  }
}

/** 이번에 정한 닉네임을 다음 방문 때 쓰도록 저장한다. */
export function saveNickname(name: string): void {
  try {
    localStorage.setItem(NICK_KEY, name);
  } catch {
    /* 저장 실패해도 이번 세션엔 영향 없다. */
  }
}
