/* ============================================================
   joystick — 화면에 보이는 조이스틱 위젯
   ------------------------------------------------------------
   판 위에서 끌어 조작하면 손가락이 화살을 가린다. 그래서 조작면을 판 밖으로
   빼서 따로 둔다 — 세로 화면에서는 판 아래 빈 자리에, 가로 화면에서는 판 옆에
   앉는다(뷰포트 왼쪽 아래 고정, CSS가 자리를 잡는다).

   **입력은 여기서 만들지 않는다.** 이 요소에 core의 TouchInput이 붙어 InputState를
   낸다. 여기가 하는 일은 노브를 손가락 쪽으로 옮겨 "지금 어디로 밀고 있는지"를
   보여주는 것뿐이다 — 순수 표현이라 게임 판정과 무관하다.
   ============================================================ */

/** 노브가 중심에서 벗어날 수 있는 최대 거리(위젯 반지름 대비). */
const KNOB_REACH = 0.34;

export class Joystick {
  private pointerId: number | null = null;
  /** 위젯 크기는 제스처 중에 안 변한다 — pointermove마다 레이아웃을 읽지 않는다. */
  private rect: DOMRect | null = null;

  /** @param element 위젯 뿌리 @param knob 안쪽에서 움직이는 원 */
  constructor(
    private readonly element: HTMLElement,
    private readonly knob: HTMLElement,
  ) {
    // 조작 자체는 TouchInput 몫이라 여기서는 preventDefault도 캡처도 하지 않는다.
    element.addEventListener("pointerdown", this.onDown, { passive: true });
    element.addEventListener("pointermove", this.onMove, { passive: true });
    element.addEventListener("pointerup", this.onUp, { passive: true });
    element.addEventListener("pointercancel", this.onUp, { passive: true });
  }

  /** 이 게임에서 조이스틱을 쓰는가. 안 쓰면 화면에서 아예 빼 둔다. */
  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
    if (!visible) this.release();
  }

  private onDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") return;
    this.pointerId = event.pointerId;
    this.rect = this.element.getBoundingClientRect();
    this.element.classList.add("held");
    this.moveKnob(event);
  };

  private onMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.moveKnob(event);
  };

  private onUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.release();
  };

  private release(): void {
    this.pointerId = null;
    this.rect = null;
    this.element.classList.remove("held");
    this.knob.style.transform = ""; // 손을 떼면 가운데로 돌아온다.
  }

  /** 노브를 손가락 쪽으로. 위젯 밖으로는 안 나가게 반지름에 가둔다 — 안 가두면
   *  화면을 가로질러 끌었을 때 노브가 판 위로 날아간다. */
  private moveKnob(event: PointerEvent): void {
    if (!this.rect || this.rect.width === 0) return;
    const dx = (event.clientX - (this.rect.left + this.rect.width / 2)) / this.rect.width;
    const dy = (event.clientY - (this.rect.top + this.rect.height / 2)) / this.rect.height;
    const distance = Math.hypot(dx, dy);
    const scale = distance > KNOB_REACH ? KNOB_REACH / distance : 1;
    this.knob.style.transform =
      `translate(${(dx * scale * this.rect.width).toFixed(1)}px, ${(dy * scale * this.rect.height).toFixed(1)}px)`;
  }
}
