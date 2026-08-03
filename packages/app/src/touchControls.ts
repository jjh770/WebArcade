/* ============================================================
   touchControls — 판 밖 조작면 일체를 소유한다
   ------------------------------------------------------------
   한 게임의 "손가락으로 어떻게 조작하는가"에 필요한 것이 여기 다 모여 있다:
   입력 소스 셋(판 절반 / 조이스틱 / 방향키 버튼), 조이스틱 노브 표현,
   카운트다운 안내, 그리고 **조작이 세로를 얼마나 먹는지**를 알리는 body 클래스.

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
import { TOUCH_SCHEMES, type TouchScheme } from "./touchSchemes";

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
  /** 조작면 유무가 바뀌어 판이 쓸 세로가 달라졌다 — 판 크기를 다시 잡아야 한다. */
  onSpaceChange: () => void;
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
  }

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
    const active = this.usable ? this.scheme : null;
    const stick = active === "joystick";
    const buttons = active === "buttons";
    this.joystick.setVisible(stick);
    this.options.dpad.hidden = !buttons;
    const changed =
      document.body.classList.contains("controls-stick") !== stick ||
      document.body.classList.contains("controls-buttons") !== buttons;
    document.body.classList.toggle("controls-stick", stick);
    document.body.classList.toggle("controls-buttons", buttons);
    if (changed) this.options.onSpaceChange();
  }
}
