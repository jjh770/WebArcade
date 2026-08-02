/* ============================================================
   touchSchemes — 게임이 고를 수 있는 터치 조작 방식
   ------------------------------------------------------------
   게임은 방식의 **이름 하나만** 고른다(GameRegistry). 매핑·조작면·안내가
   여기 한 줄로 묶여 있어 "좌우로 조작하는데 끌라고 안내"하는 어긋난 조합이
   애초에 표현되지 않는다.
   ============================================================ */

import { joystick8, splitLeftRight, type TouchMapper } from "@arcade/core";

export type TouchScheme = "halves" | "joystick";

type SchemeSpec = {
  map: TouchMapper;
  /** 어디를 만지는가. canvas = 게임판 자체, stick = 판 밖의 조이스틱 위젯. */
  surface: "canvas" | "stick";
  /** 카운트다운 동안 판 위에 안내 오버레이를 깔아 화면을 어둡게 덮는가.
   *  덮는 방식은 카운트다운의 반투명 막을 걷어도 숫자가 읽힌다(자기가 막을 까니까).
   *  안 덮는 방식(조이스틱)은 막을 그대로 둬야 한다 — 걷으면 숫자가 밝은 게임판
   *  위에 1.3:1로 남아 안 보인다. */
  dimsBoard: boolean;
};

export const TOUCH_SCHEMES: Record<TouchScheme, SchemeSpec> = {
  // 커브 피버: 좌우로만 꺾으므로 판을 반으로 나눠 누르고 있는다.
  halves: { map: splitLeftRight, surface: "canvas", dimsBoard: true },
  // 죽림고수: 사방으로 움직이므로 조이스틱. 판 위에서 조작하면 손가락이 화살을 가린다.
  joystick: { map: joystick8, surface: "stick", dimsBoard: false },
};
