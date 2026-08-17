/* ============================================================
   scoreUnits — 운영 스크립트가 아는 "이 게임의 기록은 무엇인가"
   ------------------------------------------------------------
   같은 사실이 저장소 안에 셋 있다. 하나로 합칠 수가 없어서 셋이다:

     ① 게임 config의 `scoreUnit` — **원본.** 그 게임이 자기 기록을 뭐라고 부르는지.
     ② packages/edge/src/timedGames.ts — 서버가 켜는 방어 스위치. 게임 코드를
        import하면 edge가 games를 알게 되므로 못 읽는다(의존 방향이 무너진다).
     ③ 이 파일 — 운영 스크립트용. **.mjs라 TS를 못 읽는다.**

   그래서 합치는 대신 **어긋나면 빨간불이 켜지게** 했다: tests/GameTables.test.ts가
   셋을 맞대 본다. 게임을 추가하고 여기를 빼먹으면 그 테스트가 이름까지 짚어 준다.

   board.mjs 안에 두지 않고 따로 뺀 이유가 그것이다 — board.mjs는 최상위에서 명령을
   실행해 버려서 테스트가 import할 수 없다.
   ⚠️ 게임을 추가하면 여기 한 줄. 서버에 "게임 목록"을 묻는 경로는 없다(서버는 gameId를
      문자열로만 다룬다).
   ============================================================ */

/** 게임id → 기록의 단위. 게임 config의 scoreUnit과 같은 값이어야 한다. */
export const SCORE_UNIT = {
  jungnim: "ticks",
  curve: "ticks",
  floor: "ticks",
  baseball: "points",
  aim: "points",
  shoot: "points",
};

/** 순위표가 있는 게임 전부. `rm all`이 이 목록을 훑는다. */
export const GAMES = Object.keys(SCORE_UNIT);

/** 기록 하나를 그 게임의 단위로 적는다. 모르는 게임이면 숫자만 — 단위를 지어내지 않는다. */
export function formatScore(gameId, score) {
  if (SCORE_UNIT[gameId] === "ticks") return `${(score / 60).toFixed(1)}s`;
  if (SCORE_UNIT[gameId] === "points") return `${score}점`;
  return String(score);
}
