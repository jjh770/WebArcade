/* ============================================================
   TouchInput — 화면을 누른 자리를 InputState로 변환
   ------------------------------------------------------------
   core는 게임을 모르므로 "화면 어디를 누르면 어느 방향인가"를 정하지 않는다.
   그건 게임마다 다르다(커브 피버는 좌/우 절반, 죽림고수는 8방향이 필요하다).
   그래서 순수 함수 TouchMapper를 밖에서 받는다 — 매핑은 앱(GameRegistry) 소관.

   누르고 있는 동안 눌린 것으로 친다. 커브 피버는 방향키를 "꾹 누르는" 게임이라
   탭 한 번이 아니라 손가락을 대고 있는 시간만큼 꺾여야 한다.

   ⚠️ 마우스는 무시한다. 데스크톱의 조작은 방향키이고, 캔버스를 클릭했다고
      캐릭터가 꺾이면 놀란다.
   ============================================================ */

import type { InputState } from "@arcade/shared";
import type { InputSource } from "./InputSource";
import { mergeInputs } from "./InputSource";

/** 요소 안의 상대 좌표(0~1)를 눌린 방향으로 바꾼다. true인 키만 담는다.
 *  좌표는 이 매핑이 붙은 요소 기준이다 — 게임판일 수도, 조이스틱 위젯일 수도 있다. */
export type TouchMapper = (nx: number, ny: number) => Partial<InputState>;

export type Point = { x: number; y: number };

/** 좌/우 절반. 커브 피버처럼 좌우로만 꺾는 게임용. */
export const splitLeftRight: TouchMapper = (nx) => (nx < 0.5 ? { left: true } : { right: true });

/** 중심에서 이만큼(위젯 크기 대비) 벗어나야 방향으로 친다.
 *  가운데를 짚기만 하면 제자리 — 손을 얹었다고 캐릭터가 튀면 안 된다. */
const DEAD_ZONE = 0.15;

/** 8방향을 각도 순서대로. y는 화면 아래가 +라서 down이 먼저 온다. */
const SECTORS: readonly Partial<InputState>[] = [
  { right: true },
  { right: true, down: true },
  { down: true },
  { left: true, down: true },
  { left: true },
  { left: true, up: true },
  { up: true },
  { right: true, up: true },
];

/** 조이스틱 위젯. 위젯 **중심**에서 민 방향이 곧 이동 방향이다(8방향).
 *  죽림고수처럼 사방으로 움직이는 게임용.
 *
 *  게임판이 아니라 별도 위젯에 붙인다 — 판 위에서 조작하면 손가락이 화살을 가린다. */
export const joystick8: TouchMapper = (nx, ny) => {
  const dx = nx - 0.5;
  const dy = ny - 0.5;
  if (Math.hypot(dx, dy) < DEAD_ZONE) return {};
  // 45도 단위로 스냅. 축별 임계값으로 나누면 대각선 영역이 부당하게 넓어진다.
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return SECTORS[((sector % 8) + 8) % 8];
};

const EMPTY: InputState = { up: false, down: false, left: false, right: false };

export class TouchInput implements InputSource {
  private listening = false;
  private mapper: TouchMapper | null = null;
  /** 눌려 있는 손가락별 방향. 두 손가락이면 두 방향이 동시에 눌린 것이다. */
  private readonly active = new Map<number, InputState>();
  /** 이번 제스처가 시작될 때 잰 요소 크기. pointermove마다 다시 재지 않는다
   *  — 초당 수십 번 레이아웃을 읽게 되고, 한 번의 터치 동안 크기는 안 변한다. */
  private rect: DOMRect | null = null;

  constructor(private readonly element: HTMLElement) {}

  /** 게임마다 다른 매핑을 갈아 끼운다. null이면 이 소스는 아무것도 내지 않는다
   *  (터치 조작이 아직 없는 게임). */
  setMapper(mapper: TouchMapper | null): void {
    this.mapper = mapper;
    if (!mapper) this.active.clear();
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.element.addEventListener("pointerdown", this.onDown);
    this.element.addEventListener("pointermove", this.onMove);
    this.element.addEventListener("pointerup", this.onUp);
    this.element.addEventListener("pointercancel", this.onUp);
  }

  stop(): void {
    if (!this.listening) return;
    this.listening = false;
    this.element.removeEventListener("pointerdown", this.onDown);
    this.element.removeEventListener("pointermove", this.onMove);
    this.element.removeEventListener("pointerup", this.onUp);
    this.element.removeEventListener("pointercancel", this.onUp);
    this.active.clear();
    this.rect = null;
  }

  getState(): InputState {
    if (this.active.size === 0) return { ...EMPTY };
    return mergeInputs([...this.active.values()]);
  }

  /** 요소 안 상대 좌표(0~1)를 방향으로. 요소가 아직 크기를 못 가졌으면 null. */
  private resolve(event: PointerEvent, rect: DOMRect): InputState | null {
    if (!this.mapper || rect.width === 0 || rect.height === 0) return null;
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    return { ...EMPTY, ...this.mapper(nx, ny) };
  }

  private onDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") return;
    this.rect = this.element.getBoundingClientRect();
    const dir = this.resolve(event, this.rect);
    if (!dir) return;
    this.active.set(event.pointerId, dir);
    event.preventDefault();
    // 손가락이 요소 밖으로 나가도 이 요소가 계속 이벤트를 받게 한다.
    // 이미 떼어진 포인터면 NotFoundError를 던진다 — 캡처는 있으면 좋은 것이라
    // 실패해도 조작은 그대로 굴러가야 한다. 그래서 preventDefault 뒤에 둔다.
    try {
      this.element.setPointerCapture?.(event.pointerId);
    } catch {
      /* 캡처 실패는 무시 — 요소 밖으로 나간 손가락만 놓칠 뿐이다. */
    }
  };

  private onMove = (event: PointerEvent): void => {
    // 누르고 있는 손가락만 본다. 그냥 지나가는 포인터는 조작이 아니다.
    if (!this.active.has(event.pointerId) || !this.rect) return;
    const dir = this.resolve(event, this.rect);
    // 손을 떼지 않고 방향을 바꿀 수 있다 — 조이스틱을 돌리거나 절반을 넘어가거나.
    if (dir) this.active.set(event.pointerId, dir);
    event.preventDefault();
  };

  private onUp = (event: PointerEvent): void => {
    if (!this.active.delete(event.pointerId)) return;
    if (this.active.size === 0) this.rect = null;
    event.preventDefault();
  };
}
