/* ============================================================
   optionsScreen — 옵션 화면의 내용 (전이는 main 몫)
   ------------------------------------------------------------
   rankingScreen과 같은 결이다: 화면을 여닫는 건 앱 상태(FSM)가 정하고, 여기서는
   그 화면 **안쪽**만 채운다.

   소리 음량 셋을 다룬다. 켬/끔이 아니라 **음량**인 이유: 음악은 끄고 싶은 게
   아니라 게임 소리에 묻히지 않을 만큼만 낮추고 싶은 경우가 대부분이다.

   판 음악과 로비 음악을 나눈 이유도 같다 — 판에서는 발소리와 니어 미스를 들어야
   하니 음악을 낮추고, 로비에서는 음악뿐이라 키워도 된다.

   ⚠️ 값의 주인은 여기가 아니다 — 효과음은 audio, 음악은 bgm이 각자 갖고 저장까지
      한다. 이 화면은 물어보고 옮겨 줄 뿐이라, 다른 경로로 바뀌어도(헤더 🔊) 다시
      열면 맞는 상태가 보인다.
   ============================================================ */

import { getSfxVolume, isSfxMuted, play, setSfxVolume } from "./audio";
import { getMusicVolume, isMusicMuted, setMusicVolume } from "./bgm";
import { byId } from "./dom";

type Slider = {
  /** `<input type="range">`의 id. 옆의 백분율 표시는 `${id}-out`이다. */
  id: string;
  get: () => number;
  set: (value: number) => void;
  /** 놓았을 때 들려줄 맛보기 소리가 있는가(효과음 슬라이더만). */
  preview?: true;
};

const SLIDERS: readonly Slider[] = [
  { id: "opt-vol-game", get: () => getMusicVolume("game"), set: (v) => setMusicVolume("game", v) },
  { id: "opt-vol-lobby", get: () => getMusicVolume("lobby"), set: (v) => setMusicVolume("lobby", v) },
  { id: "opt-vol-sfx", get: getSfxVolume, set: setSfxVolume, preview: true },
];

/** 슬라이더 하나를 지금 값에 맞춘다(손잡이 위치 + 옆의 백분율). */
function paint(item: Slider): void {
  const input = byId<HTMLInputElement>(item.id);
  const percent = Math.round(item.get() * 100);
  input.value = String(percent);
  byId(`${item.id}-out`).textContent = `${percent}%`;
}

/** 옵션 화면을 열 때마다 부른다(다른 곳에서 바뀐 값이 있을 수 있다). */
export function renderOptions(): void {
  for (const item of SLIDERS) paint(item);
  // 슬라이더는 0보다 크게 올리면 스스로 음소거를 푼다. 그래서 여기 걸릴 수 있는 건
  // 헤더 🔊로 꺼 둔 경우뿐이다 — 슬라이더가 한가운데인데 아무 소리도 안 나는
  // 상황을 설명해 준다(안 그러면 고장으로 보인다).
  byId("opt-muted-note").hidden = !(isSfxMuted() && isMusicMuted());
}

/** 슬라이더에 동작을 건다. 앱 시작 때 한 번. */
export function initOptions(): void {
  for (const item of SLIDERS) {
    const input = byId<HTMLInputElement>(item.id);
    // input: 끄는 동안 계속. 소리가 즉시 따라가야 얼마나 키웠는지 귀로 안다.
    input.addEventListener("input", () => {
      item.set(Number(input.value) / 100);
      byId(`${item.id}-out`).textContent = `${input.value}%`;
      byId("opt-muted-note").hidden = !(isSfxMuted() && isMusicMuted());
    });
    // change: 손을 뗐을 때 한 번. 효과음은 흐르지 않으므로 맛보기를 들려줘야
    // 방금 정한 크기를 알 수 있다(음악은 이미 흐르고 있어 필요 없다).
    if (item.preview) input.addEventListener("change", () => play("click"));
  }
}
