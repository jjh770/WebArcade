/* ============================================================
   사용자 로컬 설정 — localStorage에 저장하는 자잘한 선호값.
   ------------------------------------------------------------
   닉네임과 소리 켬/끔. 매번 다시 정하지 않게 마지막 값을 기억한다.
   localStorage가 없거나 던지면(사생활 보호 모드 등) 조용히 넘어간다.
   (게임별 최고기록은 성격이 달라 personalBest.ts에 따로 둔다.)
   ============================================================ */

const NICK_KEY = "arcade:nickname";
/** ⚠️ 옛 열쇠. 소리가 하나뿐이던 시절의 값이다 — 배경음악이 생기며 효과음·음악으로
 *  갈렸다. 지우지 않고 **새 값이 없을 때의 기본값**으로만 읽는다: 소리를 꺼 두고
 *  떠났던 사람이 다시 왔을 때 갑자기 음악이 울리면 안 된다. */
const OLD_MUTE_KEY = "arcade:muted";
const SFX_KEY = "arcade:muted:sfx";
const MUSIC_KEY = "arcade:muted:music";
const SIDE_VIEWS_KEY = "arcade:sideviews";

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

/** 한 열쇠를 읽되, 없으면 옛 열쇠(소리 하나뿐이던 시절)를 본다. 그것도 없으면 켜짐.
 *  기본이 켜짐인 이유: 아케이드는 소리가 있는 쪽이 기본이다. 첫 방문에 갑자기 울리는
 *  문제는 없다 — 자동재생 정책상 사용자가 무언가를 누르기 전에는 어차피 안 난다. */
function loadFlag(key: string): boolean {
  try {
    return (localStorage.getItem(key) ?? localStorage.getItem(OLD_MUTE_KEY)) === "1";
  } catch {
    return false;
  }
}

function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* 저장 실패해도 이번 세션엔 영향 없다. */
  }
}

/** 효과음을 꺼 뒀는가. */
export function loadSfxMuted(): boolean {
  return loadFlag(SFX_KEY);
}

export function saveSfxMuted(muted: boolean): void {
  saveFlag(SFX_KEY, muted);
}

/** 배경음악을 꺼 뒀는가. */
export function loadMusicMuted(): boolean {
  return loadFlag(MUSIC_KEY);
}

export function saveMusicMuted(muted: boolean): void {
  saveFlag(MUSIC_KEY, muted);
}

/** 판이 도는 동안 남의 화면을 곁창으로 볼 것인가. **기본은 켜짐**이다 —
 *  저장된 값이 없을 때 꺼 두면 처음 온 사람은 관전이라는 게 있는 줄도 모른다.
 *  ⚠️ 이건 **각자의 설정**이지 방의 규칙이 아니다(2026-08-18 사용자 결정). 끄면 곁창이
 *     차지하던 자리가 판으로 가서 판이 커진다 — 그 이득을 알고 고른 선택이다.
 *  ⚠️ 죽은 뒤 남의 화면으로 넘어가는 것은 이 설정과 **무관하다.** 저건 곁창이 아니라
 *     내 판 자리에서 일어나는 일이고, 끄든 켜든 그대로 넘어간다. */
export function loadSideViews(): boolean {
  // ⚠️ loadFlag를 안 쓴다. 저건 값이 없으면 **옛 음소거 열쇠**를 대신 읽고(승계) 기본이
  //    꺼짐인데, 여기서는 둘 다 틀리다 — 소리와 아무 상관이 없고 기본은 켜짐이다.
  try {
    const saved = localStorage.getItem(SIDE_VIEWS_KEY);
    return saved === null ? true : saved === "1";
  } catch {
    return true;
  }
}

export function saveSideViews(on: boolean): void {
  saveFlag(SIDE_VIEWS_KEY, on);
}

/* ---- 음량 ----------------------------------------------------------------
   소리의 갈래마다 따로 기억한다. 판 음악과 로비 음악을 나눈 이유: 판에서는
   게임 소리를 들어야 하니 음악을 낮추고 싶고, 로비에서는 음악만 있으니 키워도
   된다 — 하나로 묶으면 둘 중 한쪽이 늘 어긋난다. */

export type VolumeKind = "lobby" | "game" | "sfx";

const VOLUME_KEYS: Record<VolumeKind, string> = {
  lobby: "arcade:vol:lobby",
  game: "arcade:vol:game",
  sfx: "arcade:vol:sfx",
};

/** 손대지 않았을 때의 값. **한가운데(50%)에 둔다** — 지금까지 맞춰 온 음량이
 *  여기고, 위아래로 같은 폭만큼 움직일 수 있다는 게 슬라이더를 보면 바로 읽힌다. */
export const DEFAULT_VOLUME = 0.5;

/** 0~1 사이 값. 없거나 깨졌거나 범위 밖이면 기본값 — 손으로 고친 localStorage에
 *  음량이 5로 적혀 있어도 귀가 다치면 안 된다. */
export function loadVolume(kind: VolumeKind): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEYS[kind]);
    if (raw === null) return DEFAULT_VOLUME;
    const value = Number(raw);
    if (!Number.isFinite(value)) return DEFAULT_VOLUME;
    return Math.min(1, Math.max(0, value));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function saveVolume(kind: VolumeKind, value: number): void {
  try {
    localStorage.setItem(VOLUME_KEYS[kind], String(Math.min(1, Math.max(0, value))));
  } catch {
    /* 저장 실패해도 이번 세션엔 영향 없다. */
  }
}
