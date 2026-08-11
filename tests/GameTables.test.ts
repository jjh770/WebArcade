/* ============================================================
   GameTables — "이 게임의 기록은 무엇인가"가 세 곳에서 같은 말을 하는가
   ------------------------------------------------------------
   구조를 붙드는 테스트는 이 저장소의 기본값이 아니다. 여기 하나를 두는 이유:

   같은 사실이 셋으로 흩어져 있는데 **합칠 수가 없다.**
     ① 게임 config의 scoreUnit — 원본(GameRegistry가 그대로 꺼내 온다)
     ② packages/edge/src/timedGames.ts — 서버가 games를 import하면 의존 방향이 무너진다
     ③ scripts/scoreUnits.mjs — .mjs라 TS를 못 읽는다

   셋 다 나름의 이유로 그 자리에 있으므로 남기되, **어긋나는 것만 막는다.** 어긋나도
   타입 검사는 깨끗하고 게임도 잘 돈다 — 순위표 단위가 틀리거나(NaN·"4.0s"짜리 점수)
   자기신고 방어가 조용히 꺼질 뿐이라, 사람이 알아채는 경로가 이 테스트 말고는 없다.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { GAME_REGISTRY } from "../packages/app/src/GameRegistry";
import { isTimedGame } from "../packages/edge/src/timedGames";
import { SCORE_UNIT } from "../scripts/scoreUnits.mjs";

/** 원본: 등록된 게임 → 그 게임이 스스로 말하는 기록의 단위. */
const registryUnits = Object.fromEntries(
  Object.entries(GAME_REGISTRY).map(([id, entry]) => [id, entry.scoreUnit]),
);

describe("게임별 기록 단위가 세 곳에서 일치한다", () => {
  it("운영 스크립트의 표가 GameRegistry와 같다", () => {
    // 통째로 맞대므로 빠진 게임·남는 게임·틀린 단위가 한 번에 드러난다.
    expect(SCORE_UNIT).toEqual(registryUnits);
  });

  it("서버의 시간 게임 표가 단위와 일치한다", () => {
    const onServer = Object.fromEntries(Object.keys(registryUnits).map((id) => [id, isTimedGame(id)]));
    const expected = Object.fromEntries(Object.entries(registryUnits).map(([id, u]) => [id, u === "ticks"]));
    expect(onServer).toEqual(expected);
  });

  it("서버가 모르는 게임은 검사를 건너뛴다 — 없는 게임이 시간 게임으로 새지 않는다", () => {
    // timedGames의 계약: 표에 없으면 방어가 꺼질 뿐 아무것도 막히지 않는다.
    expect(isTimedGame("아직-없는-게임")).toBe(false);
  });
});
