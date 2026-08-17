/* ============================================================
   touchSchemes — 게임이 고를 수 있는 터치 조작 방식
   ------------------------------------------------------------
   게임은 방식의 **이름 하나만** 고른다(GameRegistry). 매핑·조작면·안내가
   여기 한 줄로 묶여 있어 "좌우로 조작하는데 끌라고 안내"하는 어긋난 조합이
   애초에 표현되지 않는다.

   조작면은 네 가지고, 그중 둘만 좌표를 방향으로 바꾼다:
   - canvas / stick : 누른 **자리**가 방향이다 → TouchMapper가 필요하다.
   - buttons        : 누른 **버튼**이 방향이다 → 매핑이라는 개념이 없다.
   - keypad / aim   : 애초에 **방향이 아니다** → InputState를 만들지 않는다.
   그래서 SchemeSpec은 판별 유니온이다. buttons에 map을 다는 실수가 타입에서 막힌다.

   ⚠️ keypad·aim은 앞의 셋과 종류가 다르다. 저 셋은 InputState(누르고 있는 방향)를
      만들지만 이 둘은 밀어 넣는다 — 글자 슬러그(IGame.typeKey)와 조준 좌표(IGame.aim).
      조작면이라는 점만 같아서 여기 함께 두고, 입력이 흐르는 길은 따로다
      (touchControls의 onKey · GameSession의 PointerInput).
   ⚠️ aim은 조작면이 **판 그 자체**라 세로 예산을 안 먹는다(SURFACE_CLASS에 없다).
      canvas와 같은 자리지만 매핑이 없어 따로 선다 — 좌표를 방향으로 바꾸지 않고
      좌표인 채로 게임에 준다.
   ============================================================ */

import { joystick8, splitLeftRight, type TouchMapper } from "@arcade/core";

export type TouchScheme = "halves" | "joystick" | "buttons" | "keypad" | "aim";

type SchemeSpec =
  | { surface: "canvas" | "stick"; map: TouchMapper }
  | { surface: "buttons" }
  | { surface: "keypad" }
  | { surface: "aim" };

/** 조작면의 종류. 방식(TouchScheme)이 "이 게임은 어떻게 조작하나"라면 이건 "그게 화면의
 *  어디냐"다 — 방식이 늘어도 조작면은 그대로일 수 있다. */
export type SchemeSurface = SchemeSpec["surface"];

/** **판 밖에서 자리를 차지하는** 조작면 → body에 붙일 클래스. `canvas`가 여기 없는 이유는
 *  하나뿐이다: 판 위에 겹치므로 자리를 따로 먹지 않는다(그래서 CSS도 예산을 선언하지 않는다).
 *
 *  ⚠️ 이 표가 CSS와의 **유일한 접점**이다. index.html이 이 클래스에 `--control-h`(세로)와
 *     `--control-w`(가로)를 달고, 레이아웃이 그 값을 읽어 판을 줄인다. 짝이 어긋나면 판이
 *     조작 위에 얹히는데 실기기에서만 드러나므로 Keypad 테스트가 양방향으로 못 박는다.
 *  ⭐ 조작면을 하나 더 만들면 여기 한 줄 + touchControls의 show 한 줄이다 — 전에는
 *     apply() 안에 이름이 네 번씩 박혀 있어 조작면 수만큼 그 메서드가 자랐다. */
export const SURFACE_CLASS = {
  stick: "controls-stick",
  buttons: "controls-buttons",
  keypad: "controls-keypad",
} as const satisfies Partial<Record<SchemeSurface, string>>;

/** 자리를 차지하는 조작면들(위 표의 키). */
export type SpaceSurface = keyof typeof SURFACE_CLASS;

export const TOUCH_SCHEMES: Record<TouchScheme, SchemeSpec> = {
  // 커브 피버: 좌우로만 꺾으므로 판을 반으로 나눠 누르고 있는다.
  halves: { map: splitLeftRight, surface: "canvas" },
  // 죽림고수: 사방으로 연속 이동이라 조이스틱. 판 위에서 조작하면 손가락이 화살을 가린다.
  joystick: { map: joystick8, surface: "stick" },
  // 무너지는 바닥: 격자를 한 칸씩 옮기므로 방향키 버튼 넷.
  // (숫자판은 아래에 따로 있다 — 방향을 만들지 않는 유일한 방식이다.)
  // ⚠️ 미는 위젯(조이스틱)으로 하지 않는다. 대각선 구간에서 두 방향이 동시에
  //    눌리는데 격자는 한 칸만 가고, 무엇보다 위젯이 세로를 크게 먹어 폰 세로
  //    화면에서 판을 덮는다. 버튼은 자기 크기가 곧 표적이라 경계가 눈에 보인다.
  buttons: { surface: "buttons" },
  // 숫자 야구: 방향이 아니라 숫자를 친다. 폰에는 키보드가 없으니 이게 없으면
  // 아예 못 노는 게임이 된다 — 앞의 셋과 달리 "있으면 편한" 조작면이 아니다.
  keypad: { surface: "keypad" },
  // 조준 게임: 판을 짚은 자리가 곧 조준점이다. 위젯도 버튼도 없다 — 조준을 위젯으로
  // 옮기면 겨누는 손과 보는 눈이 갈라진다.
  aim: { surface: "aim" },
};
