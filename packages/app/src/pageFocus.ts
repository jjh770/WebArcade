/* ============================================================
   pageFocus — 이 창이 지금 사용자 앞에 있는가
   ------------------------------------------------------------
   소리를 낼지 말지의 기준이다. 다른 창으로 갔거나 다른 탭을 보고 있으면
   이 페이지의 소리는 **남의 화면 위에서 울리는 소음**이다.

   두 가지를 함께 본다. 하나만으로는 새는 경우가 있다:
   - `document.hidden` — 다른 탭으로 갔다. 이 탭은 보이지 않는다.
   - `document.hasFocus()` — 탭은 보이지만 창이 뒤에 있다(두 화면을 나란히 쓸 때).
     이때 브라우저는 화면 갱신을 멈추지 않으므로 **게임이 계속 돌고 소리도 계속 난다.**

   ⚠️ 여기서 페이드는 하지 않는다. 창이 뒤로 가는 순간 브라우저는 타이머를 늦추므로
      (백그라운드 탭은 setInterval이 초 단위로 굼떠진다) 내려가는 페이드가 중간에
      얼어붙는다. 나갈 때는 즉시 끊고, 돌아올 때 부드럽게 올린다.
   ============================================================ */

type Listener = (active: boolean) => void;

const listeners: Listener[] = [];
let active = true;

/** 지금 이 창이 사용자 앞에 있는가. */
export function isPageActive(): boolean {
  return active;
}

/** 상태가 바뀔 때마다 부른다. 등록 즉시 한 번 부르지는 않는다
 *  — 부르는 쪽이 지금 상태를 물어보는 게 더 분명하다(isPageActive). */
export function watchPageFocus(listener: Listener): void {
  listeners.push(listener);
}

/** 창 상태 감시를 시작한다. main의 부트스트랩에서 한 번 부른다. */
export function initPageFocus(): void {
  const update = (): void => {
    const next = !document.hidden && document.hasFocus();
    if (next === active) return;
    active = next;
    for (const listener of listeners) listener(active);
  };
  window.addEventListener("focus", update);
  window.addEventListener("blur", update);
  document.addEventListener("visibilitychange", update);
  update(); // 배경 탭으로 열렸을 수도 있다(링크를 새 탭으로 열면 그렇다).
}
