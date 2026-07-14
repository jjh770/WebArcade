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
