/* ============================================================
   사용자 로컬 설정 — localStorage에 저장하는 자잘한 선호값.
   ------------------------------------------------------------
   닉네임과 소리 켬/끔. 매번 다시 정하지 않게 마지막 값을 기억한다.
   localStorage가 없거나 던지면(사생활 보호 모드 등) 조용히 넘어간다.
   (게임별 최고기록은 성격이 달라 personalBest.ts에 따로 둔다.)
   ============================================================ */

const NICK_KEY = "arcade:nickname";
const MUTE_KEY = "arcade:muted";

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

/** 소리를 꺼 뒀는가. 기본은 켜짐 — 아케이드는 소리가 있는 쪽이 기본값이다.
 *  (첫 방문에 갑자기 울리는 문제는 없다. 자동재생 정책상 사용자가 무언가를
 *  누르기 전에는 어차피 소리가 안 난다.) */
export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 소리 설정을 다음 방문까지 기억한다. */
export function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* 저장 실패해도 이번 세션엔 영향 없다. */
  }
}
