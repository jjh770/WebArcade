import type { PlayerPublic, RankEntry } from "@arcade/shared";
import { GAME_REGISTRY, type GameId } from "./GameRegistry";
import { PLAY_STATES, type AppState } from "./AppFlow";
import { NOTICES } from "./siteContent";

const SCREEN_NAMES = [
  "nickname", "main", "gamelist", "lobby", "ready", "countdown", "death", "result",
  "notice", "about", "community",
] as const;
type ScreenName = (typeof SCREEN_NAMES)[number];

let toastTimer = 0;

export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} 요소를 찾을 수 없습니다.`);
  return element as T;
};

export function renderState(state: AppState): void {
  let screen: ScreenName | null = null;
  if (state === "deadChoice") screen = "death";
  else if (state === "result") screen = "result";
  else if (!PLAY_STATES.has(state)) screen = state as ScreenName;

  for (const name of SCREEN_NAMES) byId(`screen-${name}`).classList.toggle("active", name === screen);
  const showPlay = PLAY_STATES.has(state);
  byId("play").classList.toggle("on", showPlay);
  document.body.classList.toggle("playing", showPlay);

  const navKey = state === "notice" || state === "about" || state === "community" ? state : "game";
  document.querySelectorAll<HTMLElement>("#site-header .site-nav button").forEach((button) => {
    button.classList.toggle("on", button.dataset.nav === navKey);
  });
}

/* ---- 플레이 영역 레이아웃 -------------------------------------------------
   메인 캔버스의 **표시 크기(CSS px)** 를 여기서 정한다. 캔버스 해상도(백킹스토어)는
   Canvas2DRenderer가 이 크기를 읽어 DPR만큼 맞춘다 — 소유권이 갈려 있다.
   게임 좌표계(논리 800x600)는 화면 크기와 무관하게 불변이다. */

/** #play의 gap / padding (CSS와 일치시킬 것). */
const PLAY_GAP = 14;
const PLAY_PADDING = 16;

/** 이 폭 미만이면 관전 칼럼을 접고 메인 화면에 공간을 전부 준다(모바일·좁은 창). */
const NARROW_VIEWPORT = 900;
/** 관전 칼럼 폭 = 뷰포트 폭의 이 비율, 단 [min, max]로 제한. */
const SIDE_WIDTH_RATIO = 0.18;
const SIDE_WIDTH_MIN = 150;
const SIDE_WIDTH_MAX = 260;

/** 플레이 영역 전체 레이아웃. 각 캔버스의 **표시 크기(CSS px)** 만 정한다.
 *  - 관전 칼럼: 뷰포트에 비례(좁으면 아예 접음). 메인보다 먼저 정해야 남는 폭이 나온다.
 *  - 메인: 남는 공간에서 게임 비율(aspect)을 유지하는 최대 사각형(레터박스).
 *  캔버스 해상도는 이 크기를 읽어 Canvas2DRenderer가 DPR에 맞춘다. */
export function layoutPlayArea(aspect: number): void {
  const narrow = window.innerWidth < NARROW_VIEWPORT;
  byId("play").classList.toggle("narrow", narrow);

  // 접히면 칼럼이 display:none → flex gap도 사라지므로 계산에서 함께 뺀다.
  const sideWidth = narrow
    ? 0
    : clamp(window.innerWidth * SIDE_WIDTH_RATIO, SIDE_WIDTH_MIN, SIDE_WIDTH_MAX);
  const sideViews = byId("side-views");
  sideViews.style.setProperty("--side-w", `${Math.floor(sideWidth)}px`);
  sideViews.style.setProperty("--side-h", `${Math.floor(sideWidth / aspect)}px`);

  const availableWidth = window.innerWidth - PLAY_PADDING * 2 - sideWidth - (narrow ? 0 : PLAY_GAP);
  const availableHeight = window.innerHeight - PLAY_PADDING * 2;
  let width = Math.max(1, availableWidth);
  let height = width / aspect;
  if (height > availableHeight) {
    height = Math.max(1, availableHeight);
    width = height * aspect;
  }
  const game = byId<HTMLCanvasElement>("game");
  game.style.width = `${Math.floor(width)}px`;
  game.style.height = `${Math.floor(height)}px`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function toast(message: string): void {
  const element = byId("error-toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove("show"), 3000);
}

export function escapeHtml(value: string): string {
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
    item.innerHTML = `<div class="notice-date">${escapeHtml(notice.date)}</div>`
      + `<div class="notice-title">${escapeHtml(notice.title)}</div>`
      + `<div class="notice-body">${escapeHtml(notice.body)}</div>`;
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
  const list = byId("ready-players");
  list.innerHTML = "";
  for (const player of players) {
    const item = document.createElement("li");
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

export function renderResult(
  finalRanks: readonly RankEntry[],
  myId: string | null,
  amHost: boolean,
): void {
  const body = byId("result-body");
  body.innerHTML = "";
  let myRank: number | null = null;
  for (const rank of finalRanks) {
    const row = document.createElement("tr");
    if (rank.id === myId) {
      myRank = rank.rank;
      row.className = "self";
    }
    row.innerHTML = `<td class="rank">${rank.rank}</td>`
      + `<td>${escapeHtml(rank.nickname)}</td>`
      + `<td class="time">${(rank.survivalTicks / 60).toFixed(1)}s</td>`;
    body.appendChild(row);
  }
  byId("result-sub").textContent = myRank ? `내 순위 ${myRank}위` : "";
  byId<HTMLButtonElement>("again-btn").style.display = amHost ? "" : "none";
  byId("result-hint").textContent = amHost
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
