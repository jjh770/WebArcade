/* ============================================================
   fullscreen — 주소창을 걷어내는 버튼
   ------------------------------------------------------------
   폰에서 브라우저 주소창이 안 걷히는 이유는 우리 화면이 **스크롤이 없어서**다.
   브라우저는 아래로 밀 때 주소창을 접는데, `.screen`이 전부 position:fixed라
   접힐 계기가 영영 오지 않는다. 그래서 브라우저에게 직접 요청한다.

   ⚠️ **아이폰 사파리에는 이 API가 없다.** iOS에서 주소창을 없애는 길은 홈 화면에
      추가뿐이다(manifest의 display:standalone). 그래서 지원하지 않는 곳에서는
      버튼을 아예 감춘다 — 눌러도 아무 일 없는 버튼을 두는 것보다 없는 게 낫다.
   ⚠️ 요청은 **사용자 동작 안에서만** 받아들여진다. 그래서 이 기능은 버튼 하나로만
      들어가고, 저장해 뒀다가 다음 방문에 자동으로 켜는 것은 불가능하다(브라우저가
      거절한다). 기억해 두지 않는 이유가 그것이다.
   ============================================================ */

import { byId } from "./dom";

/** 옛 사파리(iPad·데스크톱)는 접두사 붙은 이름만 안다. 표준 이름이 없으면 그쪽을 쓴다. */
type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const doc = document as WebkitDocument;

/** 이 브라우저가 전체화면을 내줄 수 있는가. 아이폰 사파리는 false다. */
export function isFullscreenSupported(): boolean {
  return Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled);
}

/** 지금 전체화면인가. */
export function isFullscreen(): boolean {
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

async function enter(): Promise<void> {
  const root = document.documentElement as WebkitElement;
  // ⚠️ 문서 뿌리에 건다. 게임 캔버스에만 걸면 판만 남고 HUD·조작 버튼이 사라진다.
  if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
  else await root.webkitRequestFullscreen?.();
}

async function leave(): Promise<void> {
  if (doc.exitFullscreen) await doc.exitFullscreen();
  else await doc.webkitExitFullscreen?.();
}

/** 전체화면 버튼을 잇는다. 지원하지 않는 브라우저에서는 버튼을 감춘다.
 *
 *  @param onRefused 요청이 거절됐을 때. **`fullscreenEnabled`가 true여도 거절될 수 있다** —
 *  다른 앱 안에 얹힌 브라우저(카카오톡 같은 인앱 웹뷰)나 권한이 막힌 프레임에서는
 *  "Permissions check failed"로 튕긴다. 그때 아무 말도 없으면 안 먹는 버튼이 된다.
 *
 *  ⚠️ 상태는 우리가 기억하지 않고 **브라우저에게 묻는다.** 사용자가 Esc를 누르거나
 *     안드로이드 뒤로가기로 빠져나갈 수 있어서, 우리 쪽 깃발을 들고 있으면 금세 어긋난다. */
export function initFullscreenShell(onRefused: () => void): void {
  const toggle = byId<HTMLButtonElement>("fullscreen-toggle");

  if (!isFullscreenSupported()) {
    toggle.hidden = true;
    return;
  }

  const render = (): void => {
    const on = isFullscreen();
    // ⚠️ 글자는 안 바꾼다. 들어감/나옴을 각각 나타내는 기호는 기기마다 있고 없고가
    //    갈려서(네모 안 화살표류) 어떤 폰에서는 두부만 뜬다. 대신 **색**으로 알린다.
    toggle.classList.toggle("on", on);
    // 라벨은 상태가 아니라 누르면 일어날 일을 말한다(소리 버튼과 같은 규칙).
    const label = on ? "전체화면 끄기" : "전체화면으로";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  };

  toggle.addEventListener("click", () => {
    if (isFullscreen()) {
      void leave().catch(() => undefined); // 나가기가 실패하면 이미 나가 있는 것이다.
      return;
    }
    void enter().catch(onRefused);
  });

  document.addEventListener("fullscreenchange", render);
  document.addEventListener("webkitfullscreenchange", render);
  render();
}
