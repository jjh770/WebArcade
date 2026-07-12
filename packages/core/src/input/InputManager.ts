/* ============================================================
   InputManager — 키보드 방향키를 InputState로 변환
   ------------------------------------------------------------
   core에 속하는 범용 입력 유틸. 특정 게임을 모른다 — 4방향
   InputState(shared 계약)만 만들어 넘긴다.

   ⚠️ 로컬 플레이어 입력은 결정론 대상이 아니다. 결정론이 지켜야 하는
   것은 "화살 패턴"(시드·tick 파생)이지, 내가 언제 방향키를 눌렀는지가
   아니다. 그래서 여기서 실시간 키 상태를 그대로 읽어도 불변식과 무관하다.
   (DESIGN.md 2절 4항: 판정은 로컬, 동기화는 결과만)
   ============================================================ */

import type { InputState } from "@arcade/shared";

/** 브라우저 방향키 코드 → InputState 필드 매핑. */
const KEY_MAP: Record<string, keyof InputState> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export class InputManager {
  private readonly state: InputState = {
    up: false,
    down: false,
    left: false,
    right: false,
  };

  /** 리스너 부착 대상. 기본은 window(테스트 시 주입 가능). */
  constructor(private readonly target: Window = window) {}

  /** keydown/keyup 리스너 등록. GameRunner.start()에서 호출. */
  start(): void {
    this.target.addEventListener("keydown", this.onKeyDown);
    this.target.addEventListener("keyup", this.onKeyUp);
  }

  /** 리스너 해제 + 눌림 상태 초기화(정지 후 유령 입력 방지). */
  stop(): void {
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.state.up = this.state.down = this.state.left = this.state.right = false;
  }

  /** 현재 눌림 상태의 스냅샷(복사본). 호출자가 내부 상태를 못 건드리게 한다. */
  getState(): InputState {
    return { ...this.state };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const dir = KEY_MAP[e.key];
    if (dir === undefined) return;
    this.state[dir] = true;
    e.preventDefault(); // 방향키로 페이지가 스크롤되지 않게.
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const dir = KEY_MAP[e.key];
    if (dir === undefined) return;
    this.state[dir] = false;
    e.preventDefault();
  };
}
