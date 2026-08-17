/* ============================================================
   PointerAim — 판 위의 한 점을 게임에 밀어 넣는다
   ------------------------------------------------------------
   InputManager·TouchInput과 나란히 서지만 **모양이 다르다.** 저쪽은 "지금 어느
   방향이 눌려 있는가"를 물어보면 답하고(폴링), 이쪽은 조준점이 움직인 순간을
   밀어 넣는다(푸시 → IGame.aim). KeyEntry와 같은 결이다.

   왜 InputState로 안 만드는가: 방향 넷은 「어느 쪽으로 가는가」고 조준은 「어디를
   보는가」다. 후자를 전자로 옮기면 좌표가 방향 넷을 거쳐 다시 좌표가 되는데,
   그 왕복에서 겨누는 속도가 사라진다.

   좌표는 **0~1로 정규화**해서 넘긴다. core는 게임 좌표계 크기를 모르므로
   (TouchMapper가 0~1을 받는 것과 같은 이유), 세계 크기를 곱하는 건 게임 몫이다.
   판 밖으로 나간 좌표는 버리지 않고 **가장자리에 붙인다** — 조준점이 판을 벗어나
   사라지는 것보다 벽에 붙어 기다리는 쪽이 조준하는 사람의 기대에 맞는다.

   마우스와 손가락의 규칙이 다르다:
   - 마우스는 **누르지 않아도** 따라간다. 겨누기 위해 버튼을 눌러야 한다면 그건
     조준이 아니라 드래그다.
   - 손가락은 **짚고 있는 동안만** 따라간다. 떠 있는 손가락이라는 건 없다.

   ⚠️ **짚은 자리가 곧 조준점이다.** 손끝에서 조금 띄우지도(가림 방지 오프셋),
      움직인 만큼만 옮기지도(상대 드래그) 않는다 — 둘 다 손가락을 댄 자리와 겨누는
      자리를 어긋나게 만들고, 그러면 톡 쳐서 바로 겨누는 길이 막힌다. 손가락이 표적을
      가리는 문제는 조준을 비트는 게 아니라 **표적 크기로** 푼다(2026-08-17 사용자 결정).

   ⚠️ 로컬 입력이라 결정론 대상이 아니다(InputManager 주석 참조). 조준은 내 화면의
      일이고, 공통 월드는 시드가 정한 대로 남과 똑같이 흐른다.
   ============================================================ */

/** 좌표를 잴 상자. DOMRect가 그대로 맞지만, 여기서 필요한 건 네 숫자뿐이라
 *  구조로만 받는다(그래야 브라우저 없이도 계산을 확인할 수 있다). */
export type AimBox = { left: number; top: number; width: number; height: number };

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 상자 안의 상대 좌표(0~1). 상자 밖이면 가장자리에 붙인다.
 *  아직 크기가 없는 요소(그려지기 전의 캔버스)면 null — 0으로 나눈 값을 조준점으로
 *  삼으면 NaN이 게임까지 흘러든다. */
export function normalizeInBox(
  box: AimBox,
  clientX: number,
  clientY: number,
): { nx: number; ny: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  return {
    nx: clamp01((clientX - box.left) / box.width),
    ny: clamp01((clientY - box.top) / box.height),
  };
}

export class PointerAim {
  private listening = false;
  /** 판의 자리·크기. pointermove마다 다시 재면 초당 수십 번 레이아웃을 읽는다
   *  (TouchInput이 제스처마다 한 번만 재는 것과 같은 이유). null이면 다음에 다시 잰다. */
  private box: AimBox | null = null;
  /** 판을 짚고 있는 손가락. 마우스는 여기 안 들어간다 — 누르지 않아도 조준하므로. */
  private finger: number | null = null;

  constructor(
    private readonly element: HTMLElement,
    /** 조준점이 움직일 때마다 호출. 보통 GameRunner.aim을 건다. */
    private readonly onAim: (nx: number, ny: number) => void,
  ) {}

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.box = null;
    this.element.addEventListener("pointerdown", this.onDown);
    // ⚠️ 움직임은 **창**에서 받는다. 판에만 달면 마우스가 판을 벗어난 순간 조준이
    //    얼어붙는데, 조준하는 사람에게 그건 "끊겼다"로 읽힌다. 창에서 받아 가장자리에
    //    붙여 두면 돌아왔을 때 그 자리에서 이어진다.
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
  }

  stop(): void {
    if (!this.listening) return;
    this.listening = false;
    this.element.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    this.finger = null;
    this.box = null;
  }

  /** 판의 자리·크기가 바뀌었다(창 크기·관전창 개수). 다음 조준 때 다시 잰다. */
  syncBox(): void {
    this.box = null;
  }

  private aimAt(event: PointerEvent): void {
    if (!this.box) {
      const rect = this.element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      this.box = rect;
    }
    const point = normalizeInBox(this.box, event.clientX, event.clientY);
    if (point) this.onAim(point.nx, point.ny);
  }

  private onDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") return; // 마우스는 누르지 않아도 이미 따라가고 있다.
    this.finger = event.pointerId;
    // 손가락을 댄 순간 판이 제자리에 있는지 다시 잰다 — 카운트다운 동안 판은 위에서
    // 내려오는 중이라, 그때 잰 값을 들고 있으면 조준이 통째로 어긋난다.
    this.box = null;
    event.preventDefault();
    this.aimAt(event);
    // 손가락이 판 밖으로 나가도 이 요소가 계속 이벤트를 받게 한다.
    // 이미 떼어진 포인터면 던진다 — 있으면 좋은 것이라 실패해도 조준은 굴러가야 한다.
    try {
      this.element.setPointerCapture?.(event.pointerId);
    } catch {
      /* 캡처 실패는 무시 — 판 밖으로 나간 손가락만 놓친다. */
    }
  };

  private onMove = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") {
      this.aimAt(event);
      return;
    }
    if (event.pointerId !== this.finger) return; // 짚고 있는 손가락만 조준이다.
    event.preventDefault();
    this.aimAt(event);
  };

  private onUp = (event: PointerEvent): void => {
    // 손을 떼도 조준점은 그 자리에 남는다 — 게임의 상태이지 손가락의 상태가 아니다.
    if (event.pointerId === this.finger) this.finger = null;
  };
}
