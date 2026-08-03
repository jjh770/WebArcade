/* ============================================================
   ButtonInput — 방향키 버튼 넷을 InputState로
   ------------------------------------------------------------
   TouchInput과 갈라지는 지점: 저쪽은 **한 요소 안의 좌표**를 방향으로 바꾸고
   (판 절반·조이스틱), 이쪽은 **요소 하나가 방향 하나**다. 좌표가 없으니
   매핑 함수도 데드존도 없다 — 누른 버튼이 곧 방향이다.

   왜 따로 두는가: 격자를 한 칸씩 옮기는 게임에서 미는 위젯은 세로를 많이 먹고
   경계가 눈에 안 보인다. 버튼은 자기 크기가 곧 손가락 표적이라 "여기를 누르면
   위로 간다"가 화면에 그대로 있다.

   ⚠️ 로컬 입력이라 결정론 대상이 아니다(InputManager 주석 참조).
   ============================================================ */

import type { InputState } from "@arcade/shared";
import type { InputSource } from "./InputSource";
import { mergeInputs } from "./InputSource";

/** InputState의 방향 키 넷. */
export type Direction = keyof InputState;

export type DirectionButton = { element: HTMLElement; direction: Direction };

const EMPTY: InputState = { up: false, down: false, left: false, right: false };

export class ButtonInput implements InputSource {
  private listening = false;
  /** 눌려 있는 손가락별 방향. 두 손가락이면 두 방향이 동시에 눌린 것이다. */
  private readonly held = new Map<number, Direction>();
  /** 리스너를 걷을 때 쓰려고 등록한 그대로 들고 있는다(버튼마다 다른 함수다). */
  private readonly bound: { element: HTMLElement; down: (e: PointerEvent) => void }[] = [];

  constructor(private readonly buttons: readonly DirectionButton[]) {}

  start(): void {
    if (this.listening) return;
    this.listening = true;
    for (const { element, direction } of this.buttons) {
      const down = (event: PointerEvent): void => this.onDown(event, element, direction);
      element.addEventListener("pointerdown", down);
      element.addEventListener("pointerup", this.onUp);
      element.addEventListener("pointercancel", this.onUp);
      this.bound.push({ element, down });
    }
  }

  stop(): void {
    if (!this.listening) return;
    this.listening = false;
    for (const { element, down } of this.bound) {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointerup", this.onUp);
      element.removeEventListener("pointercancel", this.onUp);
    }
    this.bound.length = 0;
    this.held.clear();
  }

  getState(): InputState {
    if (this.held.size === 0) return { ...EMPTY };
    return mergeInputs([...this.held.values()].map((dir) => ({ ...EMPTY, [dir]: true })));
  }

  /** ⚠️ 마우스는 무시한다 — 데스크톱의 조작은 방향키다(TouchInput과 같은 규칙). */
  private onDown = (event: PointerEvent, element: HTMLElement, direction: Direction): void => {
    if (event.pointerType === "mouse") return;
    this.held.set(event.pointerId, direction);
    event.preventDefault();
    // 손가락이 버튼 밖으로 나가도 이 버튼이 up을 받게 한다. 캡처가 없으면 버튼을
    // 누른 채 살짝 미끄러졌을 때 뗀 걸 못 받아 방향이 눌린 채로 굳는다.
    // ⚠️ 캡처 때문에 **누른 채 옆 버튼으로 미끄러지는 조작은 안 된다**. 한 칸씩
    //    옮기는 게임에선 그게 맞다 — 미끄러짐은 의도한 입력이 아닌 쪽이 많다.
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch {
      /* 캡처 실패는 무시 — 버튼 밖으로 나간 손가락만 놓친다. */
    }
  };

  private onUp = (event: PointerEvent): void => {
    if (!this.held.delete(event.pointerId)) return;
    event.preventDefault();
  };
}
