/* ============================================================
   shortcuts — 판 밖에서 눌린 키 하나가 무슨 뜻인가
   ------------------------------------------------------------
   게임 안의 키(방향·글자)는 core의 InputManager·KeyEntry가 가져간다. 여기는 그
   바깥, **앱이 듣는 키**만 맡는다 — 관전 중의 ←/→, 혼자 플레이 결과의 Enter·Esc.

   전에는 이 둘이 main.ts에서 각자 window 리스너를 달고 각자 "지금 무슨 화면인가"를
   되물었다. 규칙은 하나만 AppFlow에 있고 나머지는 리스너 안에 인라인이라, 같은
   성격의 판단이 두 층에 나뉘어 있었다. 셋째가 생기면 셋으로 나뉠 참이었다.

   그래서 **뜻을 정하는 일(여기)과 그 뜻대로 하는 일(main)을 가른다.** 여기는 DOM을
   모르고 아무것도 하지 않는다 — 그래서 표처럼 시험할 수 있다.

   ⚠️ 입력칸 안의 키는 여기 오지 않는다. 닉네임 입력의 Enter는 그 칸에 직접 달려
      있다 — 조합 중인 Enter(한글 확정)를 가려내야 해서 화면이 아니라 **그 칸의
      사정**으로 판단하는 일이고, 여기 표에 섞으면 둘 다 흐려진다.
   ============================================================ */

import type { AppState } from "./AppFlow";

/** 키 하나가 뜻하는 행동. 아무 뜻도 없으면 null이다(대부분의 키가 그렇다). */
export type ShortcutAction =
  /** 관전 대상을 한 칸 옮긴다. 대상 선택이 아니라 순환이라 방향만 있다. */
  | { kind: "spectate"; direction: 1 | -1 }
  /** 결과 화면의 「다시 하기」. */
  | { kind: "again" }
  /** 결과 화면의 「나가기」. */
  | { kind: "leave" };

export type ShortcutContext = {
  state: AppState;
  /** 혼자 플레이 중인가. 결과 화면의 두 키가 이것으로 갈린다(아래 ⚠️). */
  solo: boolean;
  /** 키가 눌린 채로 반복 중인가. */
  repeat: boolean;
  /** 지금 초점이 버튼에 있는가. */
  buttonFocused: boolean;
};

/** 지금 이 키가 무슨 뜻인지.
 *
 *  ⚠️ **눌린 채로 있는 키는 어느 쪽도 세지 않는다.** 관전은 한 번 눌러 한 칸이어야 하고,
 *     결과에서 세면 Enter를 붙들고 있는 동안 새 판이 프레임마다 다시 깔린다.
 *  ⚠️ 결과 화면의 두 키는 **혼자 플레이에서만** 듣는다. 멀티에서 저 두 버튼은 남들까지
 *     움직이는 일이라(전원을 대기실로 / 방을 나가기), 스치듯 누른 키로 일어나면 되돌릴
 *     방법이 없다.
 *  ⚠️ 버튼에 초점이 있을 때의 Enter도 세지 않는다. 브라우저가 이미 그 버튼을 누르므로,
 *     여기서 또 세면 한 번 누른 Enter가 두 판을 시작한다. Esc는 브라우저가 하는 일이
 *     없어 그대로 듣는다. */
export function shortcutFor(key: string, context: ShortcutContext): ShortcutAction | null {
  if (context.repeat) return null;

  if (context.state === "spectating") {
    if (key === "ArrowRight") return { kind: "spectate", direction: 1 };
    if (key === "ArrowLeft") return { kind: "spectate", direction: -1 };
    return null;
  }

  if (context.state === "result" && context.solo) {
    if (key === "Escape") return { kind: "leave" };
    if (key === "Enter" && !context.buttonFocused) return { kind: "again" };
  }

  return null;
}
