/* ============================================================
   soundShell — 소리 켬/끔 버튼과 클릭음
   ------------------------------------------------------------
   앱 상태와 무관한 껍데기다(어느 화면에 있든 똑같이 동작한다). 그래서 main의
   흐름 제어에서 떼어 여기 둔다 — main은 화면·방·라운드만 다루면 된다.
   ============================================================ */

import { isMuted, play, setMuted } from "./audio";
import { byId } from "./dom";

export function initSoundShell(): void {
  const toggle = byId<HTMLButtonElement>("sound-toggle");

  const render = (): void => {
    const off = isMuted();
    toggle.textContent = off ? "🔇" : "🔊";
    toggle.classList.toggle("off", off);
    // 라벨은 상태("소리 켜짐")가 아니라 누르면 일어날 일을 말한다.
    const label = off ? "소리 켜기" : "소리 끄기";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  };

  toggle.addEventListener("click", () => {
    setMuted(!isMuted());
    render();
  });
  render();

  /* 클릭음은 버튼마다 걸지 않고 document에 한 번 위임한다. 버튼이 늘어나도 여기
     손댈 일이 없고, 동적으로 그려지는 게임 카드·목록 버튼까지 자동으로 포함된다.
     ⚠️ 버블 단계라 각 버튼의 자기 핸들러보다 **나중에** 돈다 — 그래서 소리 토글을
     켜는 클릭은 이 줄에서 소리가 나고(켜졌음을 귀로 확인), 끄는 클릭은 조용하다.
     확인음을 따로 만들 필요가 없다. */
  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest("button");
    // ⚠️ 방향키 버튼은 뺀다. UI 버튼이 아니라 조작이라 누를 때마다 클릭음이 나면
    //    한 판 내내 딸깍거린다 — 게임 소리(부서짐)가 그 밑에 묻힌다.
    if (button && !button.closest("#dpad")) play("click");
  });
}
