/* ============================================================
   AppView — 상태에 맞는 화면과 카드 내용을 그린다
   ------------------------------------------------------------
   "무엇을 보여줄까"만 맡는다. 같은 DOM에 시간축을 얹는 연출(낙하·관전 전환·
   디버프·탄환)은 screenFx.ts, 캔버스 크기 배분은 playLayout.ts에 있다.
   ============================================================ */

import type { PlayerPublic, RankEntry } from "@arcade/shared";
import { GAME_REGISTRY, formatGameScore, type GameId } from "./GameRegistry";
import { PLAY_STATES, type AppState } from "./AppFlow";
import { byId } from "./dom";
import { NOTICES } from "./siteContent";
import type { BoardRow } from "./soloRanking";
import { newcomers, staggerIndex } from "./stagger";

const SCREEN_NAMES = [
  "nickname", "main", "gamelist", "lobby", "ready", "countdown", "result",
  "notice", "about", "community", "ranking", "options",
] as const;
type ScreenName = (typeof SCREEN_NAMES)[number];

let toastTimer = 0;

// 대기실은 renderReady가 목록을 통째로 다시 그린다. 누가 새로 들어왔는지는
// 직전 렌더의 명단과 비교해야만 알 수 있어 여기 남겨 둔다(방이 바뀌면 버린다).
let readyCode = "";
let readyIds: ReadonlySet<string> = new Set();

export function renderState(state: AppState): void {
  let screen: ScreenName | null = null;
  // dying/deadResult/spectating은 카드 없이 플레이 영역만 — 낙하·관전 연출이 그 자리를 채운다.
  if (state === "result") screen = "result";
  else if (!PLAY_STATES.has(state)) screen = state as ScreenName;

  for (const name of SCREEN_NAMES) byId(`screen-${name}`).classList.toggle("active", name === screen);
  // 카운트다운 동안에도 플레이 영역을 보여준다 — 그 위에 게임판이 내려와 자리잡는다.
  const showPlay = PLAY_STATES.has(state) || state === "countdown";
  byId("play").classList.toggle("on", showPlay);
  // 시간·스릴 게이지 HUD는 **내가 살아서 뛰는 동안에만**. 죽는 순간 값이 멈추므로
  // 그 뒤로도 띄워두면 낡은 숫자가 남는다 — 관전 중엔 남의 기록으로, 결과 화면에선
  // 순위표와 겹쳐 읽힌다. 내 기록은 결과표가, 관전은 상대 화면이 말해준다.
  byId("game-hud").hidden = state !== "playing";
  document.body.classList.toggle("playing", showPlay);
  byId("spectate-hint").hidden = state !== "spectating"; // 관전 중에만 ←/→ 힌트

  const navKey = state === "notice" || state === "about" || state === "community" || state === "ranking"
    ? state
    : "game";
  document.querySelectorAll<HTMLElement>("#site-header .site-nav button").forEach((button) => {
    button.classList.toggle("on", button.dataset.nav === navKey);
  });
}

export function toast(message: string): void {
  const element = byId("error-toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove("show"), 3000);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] as string,
  );
}

export function renderNotices(): void {
  const wrapper = byId("notice-list");
  wrapper.innerHTML = "";
  for (const notice of NOTICES) {
    const item = document.createElement("div");
    item.className = "notice-item";
    // 본문은 문단이 아니라 목록이다 — 한 줄에 하나씩만 담긴다(siteContent.Notice).
    const lines = notice.body.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
    item.innerHTML = `<div class="notice-date">${escapeHtml(notice.date)}</div>`
      + `<div class="notice-title">${escapeHtml(notice.title)}</div>`
      + `<ul class="notice-body">${lines}</ul>`;
    wrapper.appendChild(item);
  }
}

export function renderGameList(onSelect: (id: GameId) => void): void {
  const wrapper = byId("game-cards");
  wrapper.innerHTML = "";
  for (const id of Object.keys(GAME_REGISTRY) as GameId[]) {
    const entry = GAME_REGISTRY[id];
    const button = document.createElement("button");
    button.className = "game-card";
    button.innerHTML = `<div class="g-title">${escapeHtml(entry.title)}</div>`
      + `<div class="g-desc">${escapeHtml(entry.description)}</div>`;
    button.addEventListener("click", () => onSelect(id));
    wrapper.appendChild(button);
  }
}

/** 순위표에 그릴 상태. "비어 있음"과 "못 불러옴"은 다른 말이라 섞으면 안 된다 —
 *  전자는 첫 기록을 세우라는 초대이고, 후자는 서버가 대답하지 않았다는 뜻이다. */
export type RankingView =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; rows: readonly BoardRow[] };

export function renderRankingTabs(active: GameId, onSelect: (id: GameId) => void): void {
  const wrapper = byId("rank-tabs");
  wrapper.innerHTML = "";
  for (const id of Object.keys(GAME_REGISTRY) as GameId[]) {
    const button = document.createElement("button");
    button.textContent = GAME_REGISTRY[id].title;
    button.classList.toggle("on", id === active);
    button.addEventListener("click", () => onSelect(id));
    wrapper.appendChild(button);
  }
}

/** ⚠️ 여기서 "나"는 **닉네임이 같은 줄**이다. 닉네임에는 소유권이 없어서 남이 같은
 *  이름을 쓸 수 있지만, 서버가 발급한 id는 순위표에 남지 않으므로 이것 말고는
 *  본인 줄을 짚을 방법이 없다. 강조는 거들 뿐이라 틀려도 손해는 없다. */
/** ⚠️ gameId를 받는 이유는 표기 단위 하나 때문이다 — 같은 열에 어떤 게임은 초를,
 *  숫자 야구는 점을 쓴다. 탭으로 게임을 바꾸면 이 열의 뜻도 같이 바뀐다. */
export function renderRanking(view: RankingView, myNickname: string, gameId: GameId): void {
  const body = byId("rank-body");
  const note = byId("rank-note");
  body.innerHTML = "";

  if (view.state !== "ready") {
    note.hidden = false;
    note.textContent = view.state === "loading"
      ? "불러오는 중…"
      : "순위표를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.";
    return;
  }
  if (view.rows.length === 0) {
    note.hidden = false;
    note.textContent = "아직 기록이 없습니다. 혼자 플레이로 첫 기록을 세워 보세요!";
    return;
  }

  note.hidden = true;
  for (const [index, row] of view.rows.entries()) {
    const line = document.createElement("tr");
    line.classList.add("enter");
    line.style.setProperty("--i", String(staggerIndex(index)));
    if (index === 0) line.classList.add("top");
    if (row.nickname === myNickname) line.classList.add("self");
    line.innerHTML = `<td class="rank">${index + 1}</td>`
      + `<td>${escapeHtml(row.nickname)}</td>`
      + `<td class="time">${formatGameScore(gameId, row.ticks)}</td>`;
    body.appendChild(line);
  }
}

export function renderLobby(gameId: GameId): void {
  byId("lobby-title").textContent = GAME_REGISTRY[gameId].title;
  byId("lobby-hello").textContent = GAME_REGISTRY[gameId].description;
}

export function renderReady(
  code: string,
  players: readonly PlayerPublic[],
  hostId: string,
  myId: string | null,
): void {
  byId("ready-code").textContent = code;
  // 다른 방에 들어왔으면 이전 명단은 의미가 없다 — 전원이 새로 들어온 셈이다.
  if (code !== readyCode) {
    readyCode = code;
    readyIds = new Set();
  }
  const ids = players.map((player) => player.id);
  const entering = newcomers(readyIds, ids);
  readyIds = new Set(ids);

  const list = byId("ready-players");
  list.innerHTML = "";
  let order = 0;
  for (const player of players) {
    const item = document.createElement("li");
    // 새로 들어온 사람만 슬라이드인. 순서는 목록 위치가 아니라 새로 온 순서라서,
    // 한 명만 들어오면 대기 없이 바로 뜬다.
    if (entering.has(player.id)) {
      item.classList.add("enter");
      item.style.setProperty("--i", String(staggerIndex(order++)));
    }
    const name = document.createElement("span");
    name.textContent = player.nickname;
    item.appendChild(name);
    if (player.id === hostId) item.appendChild(badge("방장", ""));
    if (player.id === myId) item.appendChild(badge("나", "you"));
    list.appendChild(item);
  }
  const amHost = hostId === myId;
  byId<HTMLButtonElement>("start-btn").style.display = amHost ? "" : "none";
  byId("ready-hint").textContent = amHost ? "인원이 모이면 시작을 누르세요." : "방장이 시작하기를 기다리는 중…";
}

/** 결과 화면. ⚠️ 위쪽 버튼은 **모드마다 하는 일이 다르다** — 연습은 곧장 새 판을
 *  시작하고, 멀티는 전원을 대기실로 돌린다. 같은 버튼에 같은 이름을 붙이면 둘 중
 *  하나는 반드시 거짓말이 되므로 문구를 여기서 갈라 준다. */
export function renderResult(
  finalRanks: readonly RankEntry[],
  myId: string | null,
  amHost: boolean,
  solo: boolean,
  gameId: GameId | null,
): void {
  const body = byId("result-body");
  body.innerHTML = "";
  let myRank: number | null = null;
  for (const [index, rank] of finalRanks.entries()) {
    const row = document.createElement("tr");
    // 결과는 라운드마다 새 목록이라 매번 1위부터 순서대로 들어온다.
    row.classList.add("enter");
    row.style.setProperty("--i", String(staggerIndex(index)));
    // 1위와 본인은 서로 다른 축으로 강조된다(등수 색 / 행 배경) — 겹쳐도 둘 다 읽힌다.
    if (rank.rank === 1) row.classList.add("top");
    if (rank.id === myId) {
      myRank = rank.rank;
      row.classList.add("self");
    }
    row.innerHTML = `<td class="rank">${rank.rank}</td>`
      + `<td>${escapeHtml(rank.nickname)}</td>`
      + `<td class="time">${formatGameScore(gameId, rank.score)}</td>`;
    body.appendChild(row);
  }
  byId("result-sub").textContent = myRank ? `내 순위 ${myRank}위` : "";
  // 전체 순위표로 가는 곁길은 혼자 플레이에서만. 멀티에서 방을 두고 나가면
  // 남은 사람들의 다음 판 시작 신호를 놓친다.
  byId("result-rank-btn").hidden = !solo;
  const again = byId<HTMLButtonElement>("again-btn");
  again.style.display = amHost ? "" : "none";
  again.textContent = solo ? "다시 하기" : "대기실로";
  byId("result-hint").textContent = solo
    ? "같은 게임을 새 시드로 다시 시작합니다."
    : amHost
      ? "대기실로 돌아가 새 시드로 다시 시작할 수 있습니다."
      : "방장이 대기실로 돌아가기를 기다리는 중…";
}

export function setAliveHud(text: string, hidden = false): void {
  const hud = byId("alive-hud");
  hud.textContent = text;
  hud.hidden = hidden;
}

export function setCountdown(number: number): void {
  const element = byId("countdown-num");
  element.textContent = String(number);
  element.animate(
    [{ transform: "scale(1.5)", opacity: 0.35 }, { transform: "scale(1)", opacity: 1 }],
    { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" },
  );
}

export function setSideSlot(index: number, visible: boolean, label: string): void {
  byId(`slot-${index}`).classList.toggle("on", visible);
  if (visible) byId(`label-${index}`).textContent = label;
}

function badge(text: string, className: string): HTMLElement {
  const element = document.createElement("span");
  element.className = `badge ${className}`.trim();
  element.textContent = text;
  return element;
}
