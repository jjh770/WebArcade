/* ============================================================
   InputSource — 입력을 만들어 내는 것들의 공통 계약
   ------------------------------------------------------------
   키보드도 터치도 결국 같은 InputState(4방향)를 낸다. 게임은 그게 손가락에서
   왔는지 방향키에서 왔는지 알 필요가 없다 — IGame.update(tick, input)는
   이미 충분히 추상적이라 터치를 위해 넓힐 것이 없다.

   ⚠️ 로컬 입력은 결정론 대상이 아니다(InputManager 주석 참조).
   ============================================================ */

import type { InputState } from "@arcade/shared";

export interface InputSource {
  /** 리스너 등록. GameRunner.start()에서 호출된다. */
  start(): void;
  /** 리스너 해제 + 눌림 상태 초기화(정지 후 유령 입력 방지). */
  stop(): void;
  /** 현재 눌림 상태의 스냅샷(복사본). */
  getState(): InputState;
}

const NONE: InputState = { up: false, down: false, left: false, right: false };

/** 여러 소스를 OR로 합친다 — 키보드와 손가락 중 하나만 눌려도 눌린 것이다.
 *  DOM을 모르는 순수 함수라 테스트로 합성 규칙만 따로 확인한다. */
export function mergeInputs(states: readonly InputState[]): InputState {
  const merged = { ...NONE };
  for (const state of states) {
    if (state.up) merged.up = true;
    if (state.down) merged.down = true;
    if (state.left) merged.left = true;
    if (state.right) merged.right = true;
  }
  return merged;
}

/** 키보드 + 터치처럼 여러 소스를 하나로 묶어 러너에 넘긴다.
 *  러너는 소스가 몇 개인지 모른다 — getState() 하나만 본다. */
export class CompositeInput implements InputSource {
  private readonly sources: readonly InputSource[];

  constructor(...sources: InputSource[]) {
    this.sources = sources;
  }

  start(): void {
    for (const source of this.sources) source.start();
  }

  stop(): void {
    for (const source of this.sources) source.stop();
  }

  getState(): InputState {
    return mergeInputs(this.sources.map((source) => source.getState()));
  }
}
