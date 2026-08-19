/* ============================================================
   PointerInput — 판 위의 포인터를 게임에 밀어 넣는다
   ------------------------------------------------------------
   InputManager·TouchInput과 나란히 서지만 **모양이 다르다.** 저쪽은 "지금 어느
   방향이 눌려 있는가"를 물어보면 답하고(폴링), 이쪽은 일이 난 순간을 밀어 넣는다
   (푸시 → IGame.aim·IGame.fire). KeyEntry와 같은 결이다.

   두 가지를 나른다. **움직임과 누름은 다른 사건이다.**
   - 조준점이 옮겨 갔다(aim) — 어디를 보고 있는가.
   - 그 자리를 눌렀다(fire) — 지금 쏘았다.
   ⚠️ 처음에는 움직임만 날라서 이름이 `PointerAim`이었다. 여섯 번째 게임(에임 사격)이
      **누른 순간**을 요구했는데, 그건 조준점 좌표를 아무리 자주 보내도 안 나온다
      — 같은 자리에 서서 두 번 쏘는 것과 한 번 쏘는 것이 구별되지 않는다.

   왜 InputState로 안 만드는가: 방향 넷은 「어느 쪽으로 가는가」고 조준은 「어디를
   보는가」다. 후자를 전자로 옮기면 좌표가 방향 넷을 거쳐 다시 좌표가 되는데,
   그 왕복에서 겨누는 속도가 사라진다.

   좌표는 **0~1로 정규화**해서 넘긴다. core는 게임 좌표계 크기를 모르므로
   (TouchMapper가 0~1을 받는 것과 같은 이유), 세계 크기를 곱하는 건 게임 몫이다.
   판 밖으로 나간 좌표는 버리지 않고 **가장자리에 붙인다** — 조준점이 판을 벗어나
   사라지는 것보다 벽에 붙어 기다리는 쪽이 조준하는 사람의 기대에 맞는다.

   마우스와 손가락의 규칙이 다르다:
   - 마우스는 **누르지 않아도** 따라간다. 겨누기 위해 버튼을 눌러야 한다면 그건
     조준이 아니라 드래그다. 누름은 따로 쏘는 것이다.
   - 손가락은 **짚고 있는 동안만** 따라간다. 떠 있는 손가락이라는 건 없다.
     그래서 손가락의 톡 치기는 **겨눔과 쏘기가 한 번에** 일어난다 — 짚은 자리를 쏜다.
     ⚠️ 이 순서를 지킨다: 먼저 aim, 그다음 fire. 게임이 fire를 받았을 때 조준점이
        이미 그 자리에 가 있어야, 좌표를 안 보는 게임도 옳게 동작한다.

   ⚠️ **짚은 자리가 곧 조준점이다.** 손끝에서 조금 띄우지도(가림 방지 오프셋),
      움직인 만큼만 옮기지도(상대 드래그) 않는다 — 둘 다 손가락을 댄 자리와 겨누는
      자리를 어긋나게 만들고, 그러면 톡 쳐서 바로 겨누는 길이 막힌다. 손가락이 표적을
      가리는 문제는 조준을 비트는 게 아니라 **표적 크기로** 푼다(2026-08-17 사용자 결정).

   ⚠️ 로컬 입력이라 결정론 대상이 아니다(InputManager 주석 참조). 조준은 내 화면의
      일이고, 공통 월드는 시드가 정한 대로 남과 똑같이 흐른다.
   ============================================================ */

/** 좌표를 잴 상자. DOMRect가 그대로 맞지만, 여기서 필요한 건 네 숫자뿐이라
 *  구조로만 받는다(그래야 브라우저 없이도 계산을 확인할 수 있다). */
export type PointerBox = { left: number; top: number; width: number; height: number };

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 상자 안의 상대 좌표(0~1). 상자 밖이면 가장자리에 붙인다.
 *  아직 크기가 없는 요소(그려지기 전의 캔버스)면 null — 0으로 나눈 값을 조준점으로
 *  삼으면 NaN이 게임까지 흘러든다. */
export function normalizeInBox(
  box: PointerBox,
  clientX: number,
  clientY: number,
): { nx: number; ny: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  return {
    nx: clamp01((clientX - box.left) / box.width),
    ny: clamp01((clientY - box.top) / box.height),
  };
}

/** 마우스가 움직인 픽셀을 **판 크기 대비 비율**로 바꾼다. 판이 클수록 같은 손놀림이
 *  적게 도는데, 그래야 화면 크기와 무관하게 감도가 같다.
 *  `speed`는 각자 정한 감도(1이 기본) — 여기서 곱하는 이유는, 게임에 닿기 전에
 *  끝나야 **감도가 판정에 스미지 않기** 때문이다. 게임은 돌아간 양만 알면 된다. */
export function lookDelta(
  box: PointerBox,
  dx: number,
  dy: number,
  speed: number,
): { dnx: number; dny: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  return { dnx: (dx * speed) / box.width, dny: (dy * speed) / box.height };
}

export class PointerInput {
  private listening = false;
  /** 판의 자리·크기. pointermove마다 다시 재면 초당 수십 번 레이아웃을 읽는다
   *  (TouchInput이 제스처마다 한 번만 재는 것과 같은 이유). null이면 다음에 다시 잰다. */
  private box: PointerBox | null = null;
  /** 판을 짚고 있는 손가락. 마우스는 여기 안 들어간다 — 누르지 않아도 조준하므로. */
  private finger: number | null = null;

  /** 마우스가 **시선을 돌리는** 방식인가(FPS). 손가락에는 적용되지 않는다. */
  private lookMode = false;
  /** 시선 돌리기 감도. 각자 정한다 — 로컬 입력이라 판정과 무관하다(머리말 참조). */
  private lookSpeed = 1;

  constructor(
    private readonly element: HTMLElement,
    /** 조준점이 움직일 때마다 호출. 보통 GameRunner.aim을 건다. */
    private readonly onAim: (nx: number, ny: number) => void,
    /** 그 자리를 누른 순간 호출(마우스 왼쪽 클릭 · 손가락 톡). 보통 GameRunner.fire를 건다.
     *  쏘는 게임이 아니면 안 넘기면 된다 — 리스너는 어차피 같은 것을 쓴다. */
    private readonly onFire?: (nx: number, ny: number) => void,
    /** 마우스가 움직인 **만큼**(판 크기 대비 비율) 호출. 보통 GameRunner.look을 건다.
     *  setLook(true)일 때만 불린다. */
    private readonly onLook?: (dnx: number, dny: number) => void,
  ) {}

  /** 마우스를 「시선 돌리기」로 쓸 것인가. 게임이 look을 구현할 때만 켠다.
   *  ⚠️ **손가락은 이 값과 무관하게 늘 절대 조준이다.** 폰에는 포인터 잠금이 없어
   *     끌어서 돌리려면 발사 버튼이 따로 필요한데, 그건 「짚은 자리를 쏜다」를 뒤집는다. */
  setLook(on: boolean): void {
    this.lookMode = on;
    if (!on) this.releaseLock();
  }

  /** 마우스 감도. 0 이하는 조준을 통째로 얼려 버리므로 받지 않는다(설정 화면이
   *  막아 주지만, 여기서도 막아야 손으로 고친 값이 판을 못 돌게 만들지 못한다). */
  setLookSpeed(multiplier: number): void {
    if (multiplier > 0) this.lookSpeed = multiplier;
  }

  /** 지금 시선 돌리기가 실제로 먹히는 상태인가(= 포인터가 잠겨 있나). */
  private get locked(): boolean {
    return typeof document !== "undefined" && document.pointerLockElement === this.element;
  }

  private releaseLock(): void {
    if (this.locked) document.exitPointerLock?.();
  }

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
    this.releaseLock(); // 판이 끝났는데 커서가 잠긴 채로 남으면 결과 화면을 못 누른다.
    this.finger = null;
    this.box = null;
  }

  /** 판의 자리·크기가 바뀌었다(창 크기·관전창 개수). 다음 조준 때 다시 잰다. */
  syncBox(): void {
    this.box = null;
  }

  /** 이벤트 자리를 판 기준 0~1로. 판이 아직 크기를 못 가졌으면 null. */
  private pointOf(event: PointerEvent): { nx: number; ny: number } | null {
    if (!this.box) {
      const rect = this.element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      this.box = rect;
    }
    return normalizeInBox(this.box, event.clientX, event.clientY);
  }

  private aimAt(event: PointerEvent): void {
    const point = this.pointOf(event);
    if (point) this.onAim(point.nx, point.ny);
  }

  /** 겨누고 나서 쏜다. **순서가 계약이다**(머리말 참조) — fire를 받은 게임이 좌표를
   *  안 보고 자기 조준점을 읽어도 그 자리가 이미 맞아 있어야 한다. */
  private aimAndFire(event: PointerEvent): void {
    const point = this.pointOf(event);
    if (!point) return;
    this.onAim(point.nx, point.ny);
    this.onFire?.(point.nx, point.ny);
  }

  private onDown = (event: PointerEvent): void => {
    // 판이 제자리에 있는지 다시 잰다 — 카운트다운 동안 판은 위에서 내려오는 중이라,
    // 그때 잰 값을 들고 있으면 조준이 통째로 어긋난다.
    this.box = null;

    if (event.pointerType === "mouse") {
      // ⚠️ 왼쪽 버튼만 쏜다. 오른쪽·가운데는 메뉴와 붙여넣기의 몫이고, 그걸 발사로
      //    삼으면 판 위에서 브라우저 기능이 통째로 막힌다.
      if (event.button !== 0) return;
      event.preventDefault(); // 드래그로 판을 선택하는 것을 막는다.
      if (this.lookMode) {
        // ⚠️ **잠기기 전 첫 클릭은 쏘지 않는다.** 포인터를 잠그는 클릭이다 — 잠금은
        //    사용자 동작 안에서만 요청할 수 있고(브라우저 규칙), 그 클릭까지 발사로 치면
        //    화면을 보기도 전에 한 발이 나가 헛방 감점을 먹는다.
        //    대신 **누른 자리로 조준은 옮겨 준다** — 잠금이 안 되는 환경에서도 그 클릭이
        //    헛일이 되지 않게(아래 onMove의 되돌아가기와 짝이다).
        if (!this.locked) {
          this.aimAt(event);
          this.lock();
          return;
        }
        // 잠겨 있으면 조준점은 늘 화면 한가운데다 — 게임이 그렇게 알고 있으므로
        // 좌표를 새로 잴 필요가 없다. 지금 겨누는 자리를 그대로 쏜다.
        this.onFire?.(0.5, 0.5);
        return;
      }
      this.aimAndFire(event);
      return;
    }

    // 손가락: 겨눔과 쏘기가 한 번에 일어난다 — 짚은 자리를 쏜다.
    this.finger = event.pointerId;
    event.preventDefault();
    this.aimAndFire(event);
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
      // ⚠️ **잠겨 있을 때만 시선 돌리기다.** 안 잠겼으면 예전처럼 절대 조준으로 굴린다 —
      //    잠금이 거부되는 브라우저나 Esc로 푼 직후에 **마우스가 통째로 죽는 것**을 막는
      //    되돌아가기다(그 상태를 실제로 만들어 보고 넣었다). 다시 클릭하면 잠긴다.
      if (this.lookMode && this.locked) {
        this.lookBy(event);
        return;
      }
      this.aimAt(event);
      return;
    }
    if (event.pointerId !== this.finger) return; // 짚고 있는 손가락만 조준이다.
    event.preventDefault();
    this.aimAt(event);
  };

  /** **지금 잠근다.** 판을 시작하는 클릭(「혼자 플레이」·「시작」·「다시 하기」) 안에서 부른다 —
   *  포인터 잠금은 사용자 동작 안에서만 요청할 수 있고, 그 클릭도 엄연한 사용자 동작이다.
   *  성공하면 판이 시작될 때 이미 잠겨 있어 **따로 클릭할 일이 없다.**
   *  ⚠️ 실패할 수 있다 — 그 순간 캔버스가 아직 안 떠 있거나, 브라우저가 거부하거나(iframe),
   *     Esc로 풀린 직후일 수 있다. 그래서 **판 위 첫 클릭으로 잠그는 길을 남겨 둔다.** */
  lockNow(): void {
    if (this.lookMode && !this.locked) this.lock();
  }

  /** 포인터 잠금 요청. 실패해도(브라우저 거부·iframe 제약) 게임은 굴러가야 하므로 삼킨다. */
  private lock(): void {
    try {
      const result = (this.element as HTMLElement & {
        requestPointerLock?: () => Promise<void> | void;
      }).requestPointerLock?.();
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      /* 잠글 수 없는 환경 — 시선 돌리기가 안 될 뿐 판은 돈다. */
    }
  }

  private lookBy(event: PointerEvent): void {
    if (!this.box) {
      const rect = this.element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      this.box = rect;
    }
    const dx = event.movementX ?? 0;
    const dy = event.movementY ?? 0;
    if (dx === 0 && dy === 0) return;
    const moved = lookDelta(this.box, dx, dy, this.lookSpeed);
    if (moved) this.onLook?.(moved.dnx, moved.dny);
  }

  private onUp = (event: PointerEvent): void => {
    // 손을 떼도 조준점은 그 자리에 남는다 — 게임의 상태이지 손가락의 상태가 아니다.
    if (event.pointerId === this.finger) this.finger = null;
  };
}
