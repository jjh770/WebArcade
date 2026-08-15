/* ============================================================
   install — 홈 화면에 추가를 **사용자가 원할 때** 하게 한다
   ------------------------------------------------------------
   크롬은 설치 조건이 갖춰지면 제가 알아서 배너를 띄운다. 게임을 보러 온 사람에게
   묻지도 않고 끼어드는 자리라, 그 배너를 막고 **버튼 하나로 옮긴다.**

   막는 방법은 `beforeinstallprompt`를 가로채 preventDefault를 부르는 것이다. 그때
   받은 사건 객체는 버려지지 않고 우리가 들고 있다가, 버튼을 누르면 그제야 띄운다
   — 배너를 없애면서 설치할 길도 같이 잃지 않으려는 것이다.

   ⚠️ 이 사건은 **한 번만 쓸 수 있다.** 띄우고 나면 같은 객체로 다시 못 띄운다(크롬이
      거절한다). 그래서 쓰고 나면 버리고 버튼도 감춘다 — 다음 방문에 조건이 맞으면
      크롬이 사건을 다시 준다.
   ⚠️ 아이폰 사파리는 이 사건을 아예 안 준다. 거기서는 버튼이 영영 안 뜨고, 설치는
      공유 → 홈 화면에 추가로만 된다(그건 우리가 손댈 수 있는 자리가 아니다).
   ============================================================ */

import { byId } from "./dom";

/** 크롬이 주는 사건. 표준 타입이 아직 없어 여기서 적어 둔다. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** 이미 설치된 채로 열렸는가(홈 화면 아이콘으로 들어온 경우). */
function isInstalled(): boolean {
  return matchMedia("(display-mode: standalone)").matches;
}

export function initInstallShell(): void {
  const button = byId<HTMLButtonElement>("install-toggle");
  // 기본은 감춤이다. **설치할 수 있다는 걸 크롬이 알려 준 뒤에만** 보인다 —
  // 먼저 띄워 두면 눌러도 아무 일 없는 브라우저(사파리·이미 설치됨)가 생긴다.
  button.hidden = true;
  if (isInstalled()) return;

  let pending: InstallPromptEvent | null = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // ← 크롬이 스스로 띄우는 배너를 여기서 막는다.
    pending = event as InstallPromptEvent;
    button.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    pending = null;
    button.hidden = true;
  });

  button.addEventListener("click", () => {
    const prompt = pending;
    if (!prompt) return;
    // 띄우기 전에 버린다 — 위 ⚠️처럼 한 번뿐이라, 두 번 누르면 두 번째는 거절된다.
    pending = null;
    button.hidden = true;
    void prompt.prompt().catch(() => undefined);
  });
}
