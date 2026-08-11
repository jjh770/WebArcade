/* ============================================================
   bgm — 배경음악 (효과음과 **다른 길로** 흐른다)
   ------------------------------------------------------------
   `audio.ts`는 소리를 코드로 합성한다 — 음원 파일을 두지 않는다는 결정이 거기
   적혀 있다. 그 결정은 **효과음에 대한 것이고 지금도 유효하다.** 노래는 오실레이터로
   못 만든다. 그래서 음악만 예외로 파일을 쓰고, 그 사실을 이 파일 하나에 가둔다.

   왜 `<audio>` 요소인가(효과음처럼 decodeAudioData가 아니라):
   음악은 몇 분짜리다. 4.8MB ogg 하나를 풀면 메모리에 수십 MB의 PCM이 올라가고,
   그걸 게임마다 하나씩 들고 있게 된다. `<audio>`는 **스트리밍**이라 재생하는 만큼만
   읽고, 브라우저가 알아서 버퍼를 관리한다. 대신 정밀한 스케줄링을 못 하는데 —
   음악에는 필요 없는 능력이다(효과음은 tick 단위로 맞아야 하지만 음악은 흐르기만 한다).

   ⚠️ 자동재생 정책: 사용자가 무언가를 누르기 전에는 재생이 거부된다. play()의 프로미스가
   깨지면 **첫 조작 한 번을 기다렸다가 다시 시도한다.** 이게 없으면 주소로 바로 들어온
   사람에게 음악이 영원히 안 나온다.

   ⚠️ 실패는 전부 **조용한 무음**이다. 파일이 없든, 코덱을 모르든, 자동재생이 막히든
   게임은 그대로 돌아간다. 음악은 없어도 되는 것이다.
   ⚠️ 그 관대함이 한동안 버그를 덮고 있었다: **iOS Safari는 Ogg Vorbis를 못 읽어**
      아이폰에서 음악이 통째로 안 났는데, 조용한 무음이라 아무 신호도 없었다. 그래서
      곡마다 .m4a(AAC)를 한 벌 더 두고 브라우저에게 물어 고른다(chooseExtension).
      두 벌을 만드는 건 `node scripts/encode-bgm.mjs`.
   ============================================================ */

import { isPageActive, watchPageFocus } from "./pageFocus";
import { DEFAULT_VOLUME, loadMusicMuted, loadVolume, saveMusicMuted, saveVolume } from "./prefs";

/** 곡 이름 → `public/bgm/`의 파일 이름. 부르는 쪽은 파일명을 모른다 — 곡을 갈아끼울 때
 *  고치는 자리가 여기 한 줄이다.
 *  ⚠️ **확장자가 없다.** 같은 곡이 `.ogg`와 `.m4a` 두 벌로 있고 어느 쪽을 트는지는
 *     브라우저가 정한다(chooseExtension). 곡을 추가하면 두 벌 다 있어야 한다 —
 *     `scripts/encode-bgm.mjs`가 만들고, 빠지면 tests/Bgm.test.ts가 잡는다.
 *  ⚠️ 여기 있는 파일은 번들에 들어가지 않고 그대로 배포된다(`public/`). 20MB짜리를
 *     JS 번들에 넣으면 첫 화면이 그만큼 늦게 뜬다. */
export const TRACKS = {
  headinthesand: "headinthesand",
  blue_intermission: "blue_intermission",
  assault: "assault",
  escape_from_metal_city: "escape_from_metal_city",
  midnight_drive: "midnight_drive",
} as const;

export type TrackId = keyof typeof TRACKS;

/** 이 브라우저가 읽을 수 있는 확장자.
 *  ogg를 먼저 보는 이유: 같은 곡이 m4a보다 대체로 작다. 둘 다 되는 브라우저(크롬·파이어폭스)는
 *  ogg를 받고, ogg에 빈 문자열을 돌려주는 쪽(iOS Safari)만 m4a로 넘어간다.
 *  ⚠️ 둘 다 못 읽는 브라우저면 m4a를 고르고 조용히 실패한다 — 이 파일의 실패 방침 그대로다.
 *  @param canPlayType `HTMLMediaElement.canPlayType` — "" | "maybe" | "probably". */
export function chooseExtension(canPlayType: (type: string) => string): "ogg" | "m4a" {
  return canPlayType('audio/ogg; codecs="vorbis"') !== "" ? "ogg" : "m4a";
}

/** 확장자는 **한 번만 묻고 기억한다.** 곡을 갈아탈 때마다 물을 이유가 없고 답이 도중에
 *  바뀌지도 않는다. */
let extension: "ogg" | "m4a" | null = null;

/** 판 밖에서 흐르는 곡(메뉴·로비·대기실·결과·읽을거리).
 *  게임별 곡은 GameRegistry가 정한다 — 어느 게임에 무엇을 트는가는 UI 메타데이터다. */
export const LOBBY_TRACK: TrackId = "headinthesand";

/** 슬라이더를 끝까지 올렸을 때의 음량. 기본값(0.5)이 지금까지 맞춰 온 0.3이 되도록
 *  그 두 배로 잡았다 — 기본이 한가운데고, 키울 여지도 같은 만큼 있다.
 *  ⚠️ 그래도 음악은 효과음보다 낮게 시작한다. 음악이 게임 소리를 덮으면 니어 미스도
 *     사망도 귀로 못 잡는다. */
const CEILING = 0.6;

/** 곡을 갈아탈 때 줄이고 올리는 시간(ms). 짧게 둔다 — 카운트다운이 3초뿐이라
 *  여기서 길게 끌면 "시작!"이 아직 이전 곡 위에서 울린다. */
const FADE_MS = 450;
/** 페이드를 몇 걸음에 나눌지. `<audio>`에는 오디오 그래프의 게인 램프가 없어
 *  타이머로 음량을 계단식으로 옮긴다 — 이 정도면 귀에 계단이 안 들린다. */
const FADE_STEPS = 15;

let element: HTMLAudioElement | null = null;
let current: TrackId | null = null;
/** 앱이 지금 음악을 **원하는가**. 멈춰 있는 이유를 가르는 값이다 — 결과 화면이라
 *  일부러 걷은 것인지, 창이 뒤로 가서 잠시 끊은 것인지. 이걸 안 두면 다른 창에
 *  갔다 돌아왔을 때 조용해야 할 결과 화면에서 음악이 되살아난다. */
let wanted = false;
/** 음악을 꺼 뒀는가. **효과음과 별개의 스위치다** — 음악은 끄고 게임 소리는 듣고 싶은
 *  사람이 있다(옵션 화면에서 따로 정한다). 각 모듈이 자기 스위치를 갖는다. */
let musicMuted = false;
/** 음량은 **판 안팎으로 나뉜다.** 판에서는 게임 소리를 들어야 하니 음악을 낮추고,
 *  로비에서는 음악뿐이라 키워도 된다 — 하나로 묶으면 둘 중 하나가 늘 어긋난다.
 *  어느 쪽을 쓸지는 지금 흐르는 곡이 로비 곡인지로 정해진다(volumeKind). */
let lobbyVolume = DEFAULT_VOLUME;
let gameVolume = DEFAULT_VOLUME;

/** 자동재생이 막혀 첫 조작을 기다리는 중인가(리스너를 두 번 달지 않으려고). */
let waitingForGesture = false;
/** 진행 중인 페이드. 새 전환이 오면 반드시 걷어낸다 — 안 그러면 두 타이머가
 *  같은 음량을 서로 반대로 끌어 음악이 덜덜 떨린다. */
let fadeTimer = 0;

/** 저장된 음악 설정을 읽는다. main의 부트스트랩에서 한 번(initAudio와 나란히). */
export function initBgm(): void {
  musicMuted = loadMusicMuted();
  lobbyVolume = loadVolume("lobby");
  gameVolume = loadVolume("game");
}

/** 지금 흐르는 곡이 어느 갈래인가. 로비 곡 하나만 판 밖의 것이고 나머지는 전부 게임 곡이다. */
function volumeKind(): "lobby" | "game" {
  return current === LOBBY_TRACK ? "lobby" : "game";
}

/** 지금 걸어야 할 음량. 음소거는 음량과 **따로** 산다 — 껐다 켜도 맞춰 둔 값이 돌아온다. */
function targetVolume(): number {
  if (musicMuted || current === null) return 0;
  return (volumeKind() === "lobby" ? lobbyVolume : gameVolume) * CEILING;
}

/** 갈래별 음량(슬라이더 값 0~1). */
export function getMusicVolume(kind: "lobby" | "game"): number {
  return kind === "lobby" ? lobbyVolume : gameVolume;
}

/** 음량을 정한다. 지금 흐르는 곡이 그 갈래면 바로 반영한다 — 슬라이더를 끄는 동안
 *  소리가 따라 바뀌어야 얼마나 키웠는지 귀로 안다.
 *  ⚠️ 0보다 크게 올리면 음소거를 푼다(audio.setSfxVolume과 같은 이유). */
export function setMusicVolume(kind: "lobby" | "game", next: number): void {
  const value = Math.min(1, Math.max(0, next));
  if (kind === "lobby") lobbyVolume = value;
  else gameVolume = value;
  saveVolume(kind, value);
  if (value > 0 && musicMuted) {
    setMusicMuted(false); // 여기서 재생까지 되살아난다(syncBgmMuted)
    return;
  }
  if (kind !== volumeKind() || !element) return;
  clearInterval(fadeTimer);
  fadeTimer = 0;
  element.volume = targetVolume();
}

export function isMusicMuted(): boolean {
  return musicMuted;
}

/** 음악을 켜고 끈다. 끄면 그 자리에서 멈추고, 켜면 있던 자리에서 이어진다. */
export function setMusicMuted(next: boolean): void {
  musicMuted = next;
  saveMusicMuted(next);
  syncBgmMuted();
}

function ensureElement(): HTMLAudioElement {
  if (element) return element;
  const audio = new Audio();
  audio.loop = true; // 판이 끝날 때까지 흐른다 — 끝나는 지점이 있으면 안 된다.
  audio.volume = targetVolume();
  // 목록에 없는 곡은 미리 받지 않는다. 12MB를 첫 화면에서 당겨올 이유가 없다.
  audio.preload = "none";
  // 문서에 붙인다. 화면에는 안 보이지만(컨트롤 없음) 붙여 두면 브라우저의 「재생 중」
  // 표시와 탭 음소거가 제대로 걸리고, 무엇보다 밖에서 상태를 들여다볼 수 있다
  // — 떠다니는 객체는 소리가 안 날 때 확인할 방법이 없다.
  audio.hidden = true;
  document.body.appendChild(audio);
  element = audio;
  watchPageFocus(onFocusChange);
  return audio;
}

/** 창이 앞뒤로 오갈 때. 나갈 때는 **즉시** 끊고(페이드는 얼어붙는다 — pageFocus 주석),
 *  돌아올 때는 원래 원하던 상태였을 때만 부드럽게 올린다. */
function onFocusChange(active: boolean): void {
  const audio = element;
  if (!audio || current === null) return;
  if (!active) {
    clearInterval(fadeTimer);
    fadeTimer = 0;
    audio.pause();
    return;
  }
  if (!wanted || isMusicMuted()) return;
  start(audio);
  fade(audio, targetVolume(), () => undefined, true);
}

/** 이 곡을 튼다. 이미 같은 곡이 흐르고 있으면 아무 일도 하지 않는다
 *  — 화면이 바뀔 때마다 불러도 음악이 처음으로 되감기지 않는다.
 *
 *  다른 곡이면 **줄였다가 갈아타고 다시 올린다.** 판이 시작되는 순간 곡이 뚝 끊기면
 *  카운트다운의 긴장이 거기서 한 번 깨진다. */
export function playBgm(track: TrackId): void {
  const audio = ensureElement();
  wanted = true;
  if (current === track) {
    if (isMusicMuted()) return;
    // 멈춰 있었다면(무음 구간을 지나왔거나 꺼 뒀다 켠 경우) 있던 자리에서 다시 올린다.
    if (audio.paused) {
      start(audio);
      fade(audio, targetVolume(), () => undefined, true);
      return;
    }
    // ⚠️ 아직 내려가는 중일 수 있다(무음으로 가다가 곧바로 돌아온 경우). 그냥 두면
    //    0까지 내려가 멈춰 버린다 — 되돌려 올린다.
    if (fadeTimer !== 0) fade(audio, targetVolume(), () => undefined);
    return;
  }
  const first = current === null;
  current = track;
  // 첫 곡은 줄일 것이 없다. 그 외에는 지금 곡을 내린 뒤 갈아탄다.
  if (first || audio.paused || isMusicMuted()) {
    swap(audio, track);
    if (!isMusicMuted()) fade(audio, targetVolume(), () => undefined, true);
    return;
  }
  fade(audio, 0, () => {
    swap(audio, track);
    fade(audio, targetVolume(), () => undefined, true);
  });
}

/** 파일을 갈아끼운다. src를 바꾸는 순간 재생 위치는 버려진다(곡마다 처음부터). */
function swap(audio: HTMLAudioElement, track: TrackId): void {
  extension ??= chooseExtension((type) => audio.canPlayType(type));
  audio.src = `${import.meta.env.BASE_URL}bgm/${TRACKS[track]}.${extension}`;
  if (!isMusicMuted()) start(audio);
}

/** 음량을 target까지 계단식으로 옮기고 끝나면 done을 부른다.
 *  @param rampUp 올리는 페이드면 시작 음량을 0으로 맞춘 뒤 올린다(새 곡이 튀지 않게). */
function fade(audio: HTMLAudioElement, target: number, done: () => void, rampUp = false): void {
  clearInterval(fadeTimer);
  if (rampUp) audio.volume = 0;
  const from = audio.volume;
  const step = (target - from) / FADE_STEPS;
  let n = 0;
  fadeTimer = window.setInterval(() => {
    n++;
    // 0~1 밖으로 나가면 브라우저가 던진다. 마지막 걸음은 목표값으로 딱 맞춘다.
    audio.volume = n >= FADE_STEPS ? target : Math.min(1, Math.max(0, from + step * n));
    if (n < FADE_STEPS) return;
    clearInterval(fadeTimer);
    fadeTimer = 0;
    done();
  }, FADE_MS / FADE_STEPS);
}

/** 음악을 **잠시 걷는다.** 줄인 뒤 멈추되 곡과 위치는 그대로 둔다 — 결과 화면처럼
 *  "여기는 조용해야 한다"는 자리를 위한 것이다. 같은 곡을 다시 틀면 있던 자리에서 이어진다.
 *  ⚠️ stopBgm과 다르다: 저쪽은 처음으로 되감는다. */
export function silenceBgm(): void {
  wanted = false;
  if (!element || current === null || element.paused) return;
  const audio = element;
  fade(audio, 0, () => audio.pause());
}

/** 음악을 멈춘다(위치는 버린다 — 다음에 틀면 처음부터). */
export function stopBgm(): void {
  wanted = false;
  if (!element) return;
  clearInterval(fadeTimer);
  element.pause();
  element.currentTime = 0;
  element.volume = targetVolume();
}

/** 소리 설정이 바뀌었다. 껐으면 멈추고, 켰으면 틀던 곡을 이어서 튼다.
 *  ⚠️ 페이드 도중에 껐다 켜면 음량이 0에 멈춰 있을 수 있다 — 켤 때 제 값으로 돌린다.
 *     "소리를 켰는데 아무것도 안 들린다"가 여기서 나온다. */
export function syncBgmMuted(): void {
  if (!element || current === null) return;
  clearInterval(fadeTimer);
  fadeTimer = 0;
  if (isMusicMuted()) {
    element.pause();
    return;
  }
  element.volume = targetVolume();
  start(element);
}

function start(audio: HTMLAudioElement): void {
  // 창이 뒤에 있으면 소리를 내지 않는다. 여기 한 곳에서 막으면 부르는 자리마다
  // 같은 조건을 적을 필요가 없다(돌아오면 onFocusChange가 다시 튼다).
  if (!isPageActive()) return;
  // play()는 프로미스를 준다. 자동재생이 막히면 여기서 깨지는데, 그건 오류가 아니라
  // "아직 때가 아니다"라는 뜻이다 — 첫 조작을 기다렸다가 다시 시도한다.
  audio.play().catch(() => armGesture());
}

function armGesture(): void {
  if (waitingForGesture) return;
  waitingForGesture = true;
  const retry = (): void => {
    waitingForGesture = false;
    window.removeEventListener("pointerdown", retry);
    window.removeEventListener("keydown", retry);
    if (element && current !== null && !isMusicMuted()) element.play().catch(() => armGesture());
  };
  window.addEventListener("pointerdown", retry);
  window.addEventListener("keydown", retry);
}
