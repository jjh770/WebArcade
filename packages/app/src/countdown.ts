/* ============================================================
   countdown — 시작 전 3초
   ------------------------------------------------------------
   멀티와 솔로는 **남은 시간을 재는 방법만** 다르다(서버시각 / 로컬시각). 숫자를
   줄이고 소리를 내는 연출은 같으므로, 재는 방법을 함수로 받아 하나로 쓴다.
   (전에는 두 곳에 같은 폴링 루프가 복사돼 있었다.)

   ⚠️ 한 번에 하나만 돈다. 새로 시작하면 이전 것은 버린다 — 방을 옮기거나 다시
      시작할 때 옛 카운트다운이 남아 숫자를 덮어쓰면 안 된다.
   ============================================================ */

import { setCountdown } from "./AppView";
import { play } from "./audio";

/** 폴링 주기(ms). 숫자는 초 단위라 이보다 자주 볼 필요가 없고, 이보다 뜸하면
 *  숫자가 바뀌는 순간을 놓쳐 소리와 표시가 늦는다. */
const POLL_MS = 50;

let timer = 0;

/** @param remainingMs 지금 남은 시간(ms)을 재는 함수. 0 이하가 되면 끝난다.
 *  @param onDone 끝났을 때. 호출 시점에 타이머는 이미 정리돼 있다. */
export function runCountdown(remainingMs: () => number, onDone: () => void): void {
  let lastNumber = -1;
  const step = (): void => {
    const remaining = remainingMs();
    if (remaining <= 0) {
      cancelCountdown();
      onDone();
      return;
    }
    const number = Math.ceil(remaining / 1000);
    if (number === lastNumber) return; // 숫자가 바뀌는 순간에만 — 폴링마다가 아니다.
    lastNumber = number;
    setCountdown(number);
    play("count");
  };
  cancelCountdown();
  timer = window.setInterval(step, POLL_MS);
  step(); // 첫 숫자는 기다리지 않고 바로 띄운다.
}

export function cancelCountdown(): void {
  clearInterval(timer);
  timer = 0;
}
