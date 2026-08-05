/* ============================================================
   hud — 판 위, 캔버스 **밖**의 헤더 (기록 + 게이지)
   ------------------------------------------------------------
   매 렌더 프레임 불린다. 그래서 값이 그대로면 DOM을 안 건드린다 —
   textContent에 같은 글자를 다시 넣는 것도 공짜가 아니다.

   ⚠️ 여기 있는 두 값은 **게임마다 뜻이 다르다.** 기록은 앞의 세 게임에서 생존
   시간이고 숫자 야구에서는 점수이며, 게이지는 커브 피버에서 「차면 쏠 수 있다」인데
   숫자 야구에서는 「비면 끝난다」다. 그 차이를 여기서 if로 적지 않는다 — 전부
   레지스트리(게임의 config)에서 오고, 이 파일은 받아 적기만 한다.
   ============================================================ */

import { byId } from "./dom";
import { formatGameScore, gameEntry, type GameId } from "./GameRegistry";

/** 게이지에 경고색이 붙는 구간(가득/비어감 각각의 끝에서 15%). */
const ALARM = 0.15;

export function updateHud(gameId: GameId | null, score: number, gauge: number | null): void {
  byId("hud-time").textContent = formatGameScore(gameId, score);
  const gaugeEl = byId("hud-gauge");
  // 게이지가 없는 게임(getGauge 미구현)은 줄 자체를 숨긴다.
  if (gauge === null) {
    gaugeEl.hidden = true;
    return;
  }
  gaugeEl.hidden = false;
  const entry = gameId ? gameEntry(gameId) : null;
  const label = entry?.gaugeLabel ?? "게이지";
  const labelEl = byId("hud-gauge-label");
  if (labelEl.textContent !== label) labelEl.textContent = label;
  const clamped = Math.max(0, Math.min(1, gauge));
  const fill = byId("hud-gauge-fill");
  fill.style.width = `${clamped * 100}%`;
  // 경고색은 "지금이 중요한 순간"에 붙어야 하는데 그 순간이 게임마다 반대편이다.
  fill.classList.toggle("near", entry?.gaugeAlarm === "empty" ? clamped <= ALARM : clamped >= 1 - ALARM);
}
