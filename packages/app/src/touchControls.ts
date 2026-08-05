/* ============================================================
   touchControls — 판 밖 조작면 일체를 소유한다
   ------------------------------------------------------------
   한 게임의 "손가락으로 어떻게 조작하는가"에 필요한 것이 여기 다 모여 있다:
   입력 소스 셋(판 절반 / 조이스틱 / 방향키 버튼), 숫자판, 조이스틱 노브 표현,
   카운트다운 안내, 그리고 **조작이 세로를 얼마나 먹는지**를 알리는 body 클래스.

   ⚠️ 숫자판만 흐르는 길이 다르다. 앞의 셋은 InputState를 만들어 러너가 매 스텝
      물어 가지만(폴링), 숫자판은 눌린 순간 슬러그를 밀어 넣는다(푸시 → IGame.typeKey).
      그래서 `all` 컴포지트에 들어가지 않고 onKey 콜백으로 나간다. 여기 함께 사는
      이유는 하나뿐이다 — **조작면이라서 세로 예산을 똑같이 다툰다.**

   왜 GameSession에서 뗐나: 세션은 라운드(게임 인스턴스·관전·뷰)의 주인이지
   화면 배치의 주인이 아니다. 조작면 유무는 판 크기를 바꾸는 **레이아웃 정책**이라
   세션 안에 있으면 라운드 상태와 화면 정책이 한 클래스에서 섞인다.

   이 클래스 자체가 InputSource다. 러너는 조작면이 셋인지 하나인지 모른다.
   ============================================================ */

import {
  ButtonInput,
  CompositeInput,
  TouchInput,
  type Direction,
  type DirectionButton,
  type InputSource,
} from "@arcade/core";
import type { InputState } from "@arcade/shared";
import { Joystick } from "./joystick";
import { TouchHint, hasCoarsePointer, shouldShowHint } from "./touchHint";
import { SURFACE_CLASS, TOUCH_SCHEMES, type SpaceSurface, type TouchScheme } from "./touchSchemes";

/** 방향키 버튼의 방향은 **마크업이 정본**이다(`data-dir`). 여기서 이름을 다시 적으면
 *  버튼을 하나 옮길 때 두 곳을 맞춰야 한다. 모르는 값은 조용히 버린다. */
const DIRECTIONS = ["up", "down", "left", "right"] as const;
function readDirectionButtons(root: HTMLElement): DirectionButton[] {
  return [...root.querySelectorAll<HTMLElement>("[data-dir]")].flatMap((element) => {
    const dir = element.dataset.dir as Direction;
    return DIRECTIONS.includes(dir) ? [{ element, direction: dir }] : [];
  });
}

export type TouchControlsOptions = {
  /** 판 자체(좌/우 절반을 누르는 방식이 쓴다). 안내 오버레이도 이 크기를 따라간다. */
  board: HTMLElement;
  hint: HTMLElement;
  stick: HTMLElement;
  stickKnob: HTMLElement;
  dpad: HTMLElement;
  /** 숫자판 뿌리. 숫자를 치는 게임에서만 뜬다. */
  keypad: HTMLElement;
  /** 조작면 유무가 바뀌어 판이 쓸 세로가 달라졌다 — 판 크기를 다시 잡아야 한다. */
  onSpaceChange: () => void;
  /** 숫자판에서 글자 슬러그가 나왔다(`"0"`~`"9"`·`"back"`·`"enter"`).
   *  방향과 달리 폴링이 아니라 여기로 밀어 넣는다 — 위 파일 주석 참조. */
  onKey: (slug: string) => void;
};

export class TouchControls implements InputSource {
  // 조작면마다 소스를 따로 둔다. 게임에 맞는 쪽에만 매핑을 끼우고 나머지는 비운다
  // — 요소를 바꿔 끼우는 것보다 리스너 수명이 단순하다.
  private readonly onBoard: TouchInput;
  private readonly onStick: TouchInput;
  /** 방향키 버튼. 좌표를 방향으로 바꾸는 게 아니라 버튼 하나가 방향 하나다. */
  private readonly onButtons: ButtonInput;
  private readonly all: CompositeInput;
  private readonly joystick: Joystick;
  private readonly hint: TouchHint;
  /** 조작면을 띄우고 내리는 법. SURFACE_CLASS와 키가 같아야 하고, 빠지면 컴파일이 걸린다
   *  — 표에만 올리고 띄우는 법을 안 적으면 클래스만 붙고 아무것도 안 뜨는 조작면이 된다. */
  private readonly show: Record<SpaceSurface, (on: boolean) => void>;

  /** 이번 게임이 쓰는 방식. 마우스만 있는 기기면 null(조작면을 아예 안 띄운다). */
  private scheme: TouchScheme | null = null;
  /** 지금 조작이 먹히는가. 관전·라운드 종료 후엔 false. */
  private usable = false;

  constructor(private readonly options: TouchControlsOptions) {
    this.onBoard = new TouchInput(options.board);
    this.onStick = new TouchInput(options.stick);
    this.onButtons = new ButtonInput(readDirectionButtons(options.dpad));
    this.all = new CompositeInput(this.onBoard, this.onStick, this.onButtons);
    this.joystick = new Joystick(options.stick, options.stickKnob);
    this.hint = new TouchHint(options.hint, options.board);
    this.show = {
      // 조이스틱만 위젯이 스스로 내려간다 — 숨길 때 잡고 있던 손가락과 노브까지 놓아야 한다.
      stick: (on) => this.joystick.setVisible(on),
      buttons: (on) => {
        options.dpad.hidden = !on;
      },
      keypad: (on) => {
        options.keypad.hidden = !on;
      },
    };
    // ⚠️ 리스너를 뿌리에 하나만 단다(위임). 버튼마다 달면 열두 개를 붙였다 떼야 하고,
    //    숫자판은 뜨고 지는 일이 잦아 그 수명 관리가 곧 버그가 된다.
    // ⚠️ click이 아니라 pointerdown이다 — 톡 치는 즉시 숫자가 찍혀야 한다. click은
    //    손가락을 뗄 때 오고, 그 사이의 공백이 "안 눌렸나?" 하고 한 번 더 치게 만든다.
    options.keypad.addEventListener("pointerdown", this.onPadDown);
  }

  /** 숨어 있어도 리스너는 붙어 있지만, 숨은 요소는 pointerdown을 받지 못하므로
   *  여기 오는 건 곧 "떠 있는 숫자판을 눌렀다"는 뜻이다. */
  private onPadDown = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null;
    const slug = target?.closest<HTMLElement>("[data-key]")?.dataset.key;
    if (!slug) return; // 버튼 사이 빈틈
    // 기본 동작(포커스 이동·이어지는 click)을 막는다. 안 막으면 한 번 친 것이 두 번 든다.
    event.preventDefault();
    this.options.onKey(slug);
  };

  /* ---- InputSource — 러너에게는 그냥 소스 하나다 ------------------------- */
  start(): void {
    this.all.start();
  }
  stop(): void {
    this.all.stop();
  }
  getState(): InputState {
    return this.all.getState();
  }

  /** 이 게임의 조작 방식으로 갈아 끼운다. 게임을 바꿀 때 한 번 부른다.
   *  ⚠️ 이것만으로는 아무것도 안 뜬다 — 뜨고 지는 건 setUsable이 정한다. */
  useScheme(touch: TouchScheme | undefined): void {
    const spec = touch ? TOUCH_SCHEMES[touch] : null;
    // 이 게임이 쓰는 조작면에만 매핑을 끼운다. 나머지 면은 눌러도 아무 일이 없다.
    this.onBoard.setMapper(spec?.surface === "canvas" ? spec.map : null);
    this.onStick.setMapper(spec?.surface === "stick" ? spec.map : null);
    // 손가락 기기에서만 띄운다. 마우스만 있는 화면에 조작 요소가 뜨면 방향키를 쓰는
    // 사람에게 방해일 뿐 아니라, 세로 예산까지 축내 판이 괜히 작아진다.
    this.scheme = hasCoarsePointer() ? (touch ?? null) : null;
    this.hint.setScheme(touch ?? null);
    this.apply();
  }

  /** 지금 조작이 먹히는가(살아서 플레이 중 = true, 관전·종료 = false).
   *  ⚠️ 게임을 바꿀 때가 아니라 **라운드가 바뀔 때마다** 불러야 한다. 게임 교체 경로는
   *     같은 게임이면 건너뛰므로, 거기서만 세우면 걷힌 조작이 안 돌아온다. */
  setUsable(usable: boolean): void {
    this.usable = usable;
    this.apply();
  }

  /** 카운트다운 동안 판 위에 까는 조작 안내. 판을 덮는 방식에서만 실제로 뜬다. */
  showHint(): void {
    if (shouldShowHint(this.scheme !== null, hasCoarsePointer())) this.hint.show();
  }
  hideHint(): void {
    this.hint.hide();
  }
  /** 안내 오버레이를 판 크기에 다시 맞춘다(창 크기·관전창 개수가 바뀔 때). */
  syncHintBox(): void {
    this.hint.syncBox();
  }

  /** 조작면을 지금 상태에 맞춘다. 뜨면 body 클래스가 붙고, CSS가 그만큼 #play의 아래
   *  패딩을 키운다. 레이아웃이 그 패딩을 읽어 판을 줄이므로 판과 조작이 세로를 나눠 갖는다.
   *  ⚠️ 클래스가 바뀌었으면 반드시 다시 재야 한다(onSpaceChange). 안 그러면 다음 창
   *     크기 변경까지 예전 크기의 판이 남는다. */
  private apply(): void {
    const scheme = this.usable ? this.scheme : null;
    // 방식이 아니라 **조작면**으로 본다 — 판을 반으로 나눠 누르는 방식(canvas)은 표에 없어
    // 저절로 "아무것도 안 띄움"이 된다. 방식이 늘어도 이 메서드는 그대로다.
    const active = scheme ? TOUCH_SCHEMES[scheme].surface : null;
    let changed = false;
    for (const [surface, cls] of Object.entries(SURFACE_CLASS) as [SpaceSurface, string][]) {
      const on = surface === active;
      this.show[surface](on);
      if (document.body.classList.contains(cls) !== on) changed = true;
      document.body.classList.toggle(cls, on);
    }
    if (changed) this.options.onSpaceChange();
  }
}
