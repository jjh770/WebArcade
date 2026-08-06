/* ============================================================
   soundShell — 소리 켬/끔 버튼과 클릭음
   ------------------------------------------------------------
   앱 상태와 무관한 껍데기다(어느 화면에 있든 똑같이 동작한다). 그래서 main의
   흐름 제어에서 떼어 여기 둔다 — main은 화면·방·라운드만 다루면 된다.
   ============================================================ */

import { isSfxMuted, play, setSfxMuted } from "./audio";
import { isMusicMuted, setMusicMuted } from "./bgm";
import { byId } from "./dom";

/** @param onChange 소리 설정이 이 버튼으로 바뀌었다. **이 버튼은 모든 화면 위에 떠 있어서**
 *  옵션 화면이 열린 채로도 눌린다 — 그때 저쪽 스위치의 표시를 같이 고쳐야 한다.
 *  (여기서 옵션 화면을 직접 알지는 않는다. 바뀌었다고 알릴 뿐이다.) */
export function initSoundShell(onChange: () => void): void {
  const toggle = byId<HTMLButtonElement>("sound-toggle");

  const render = (): void => {
    // ⚠️ 스위치는 둘(효과음·음악)인데 버튼은 하나다. 이 버튼은 **빠른 침묵**이지
    //    세밀한 설정이 아니다 — 하나라도 켜져 있으면 "켜짐"으로 보이고, 누르면 전부 꺼진다.
    //    따로 켜고 끄는 건 옵션 화면이 한다.
    const off = isSfxMuted() && isMusicMuted();
    toggle.textContent = off ? "🔇" : "🔊";
    toggle.classList.toggle("off", off);
    // 라벨은 상태("소리 켜짐")가 아니라 누르면 일어날 일을 말한다.
    const label = off ? "소리 켜기" : "소리 끄기";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  };

  toggle.addEventListener("click", () => {
    // 하나라도 켜져 있으면 → 전부 끈다. 전부 꺼져 있으면 → 전부 켠다.
    const silenceAll = !(isSfxMuted() && isMusicMuted());
    setSfxMuted(silenceAll);
    setMusicMuted(silenceAll);
    render();
    onChange();
  });
  render();

  /* 클릭음은 버튼마다 걸지 않고 document에 한 번 위임한다. 버튼이 늘어나도 여기
     손댈 일이 없고, 동적으로 그려지는 게임 카드·목록 버튼까지 자동으로 포함된다.
     ⚠️ 버블 단계라 각 버튼의 자기 핸들러보다 **나중에** 돈다 — 그래서 소리 토글을
     켜는 클릭은 이 줄에서 소리가 나고(켜졌음을 귀로 확인), 끄는 클릭은 조용하다.
     확인음을 따로 만들 필요가 없다. */
  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest("button");
    // ⚠️ 조작면의 버튼은 뺀다(방향키·숫자판). UI 버튼이 아니라 조작이라 누를 때마다
    //    클릭음이 나면 한 판 내내 딸깍거린다 — 게임 소리가 그 밑에 묻힌다.
    //    숫자 야구에서는 특히 나빴다: 한 번 칠 때마다 타자음과 클릭음이 겹쳤다.
    if (button && !button.closest("#dpad, #keypad")) play("click");
  });
}
