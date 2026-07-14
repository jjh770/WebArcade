import { NetClient, StateMachine } from "@arcade/core";
import type { RankEntry, ServerMessage } from "@arcade/shared";
import { APP_TRANSITIONS, type AppEvent, type AppState } from "./AppFlow";
import {
  byId,
  layoutPlayArea,
  renderGameList,
  renderLobby,
  renderNotices,
  renderReady,
  renderResult,
  renderState,
  setAliveHud,
  setCountdown,
  setSideSlot,
  toast,
} from "./AppView";
import { GAME_REGISTRY, isGameId, type GameId } from "./GameRegistry";
import { GameSession } from "./GameSession";

/** 게임 좌표계(논리) 크기. 캔버스 픽셀 크기와 별개다 — 표시 크기는 CSS/DPR이 정하고,
 *  Canvas2DRenderer가 논리->픽셀 변환을 맡는다. 게임 로직은 항상 이 좌표만 본다. */
const LOGICAL_WIDTH = 800;
const LOGICAL_HEIGHT = 600;
const POSITION_SEND_MS = 100;

/** 게임 서버 주소.
 *  - 배포: VITE_WS_URL을 반드시 지정한다(예: wss://...). HTTPS 페이지에서 ws:// 로 붙으면
 *    브라우저가 mixed content로 차단하므로 wss:// 여야 한다.
 *  - 로컬 개발: 값이 없으면 같은 호스트의 8080(별도로 띄운 dev:server)으로 붙는다. */
const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${location.hostname || "localhost"}:8080`;

const mainCanvas = byId<HTMLCanvasElement>("game");
const sideCanvases = Array.from({ length: 3 }, (_, index) => byId<HTMLCanvasElement>(`side-${index}`));

const appState = new StateMachine<AppState, AppEvent>("nickname", APP_TRANSITIONS, ({ to }) => renderState(to));
const net = new NetClient();
const session = new GameSession({
  mainCanvas,
  sideCanvases,
  logicalWidth: LOGICAL_WIDTH,
  logicalHeight: LOGICAL_HEIGHT,
  onLocalDeath,
  onSideSlot: setSideSlot,
});
/** 표시 크기를 먼저 정하고(레이아웃), 그 크기에 맞춰 캔버스 해상도를 잡는다(렌더러). 순서 중요. */
function relayout(): void {
  layoutPlayArea(LOGICAL_WIDTH / LOGICAL_HEIGHT);
  session.resizeViews();
}
relayout();
// 창 크기·모니터(DPR) 변경 시 다시 맞춘다.
window.addEventListener("resize", relayout);

let networkReady = false;
let selectedGameId: GameId | null = null;
let myId: string | null = null;
let myNickname = "";
let amHost = false;
let finalRanks: readonly RankEntry[] = [];

function transition(event: AppEvent): boolean {
  if (!appState.can(event)) return false;
  appState.transition(event);
  return true;
}

function ensureNetwork(): boolean {
  if (networkReady && net.isClockSynchronized) return true;
  toast("서버 연결과 시각 동기화가 아직 준비되지 않았습니다.");
  return false;
}

function onLocalDeath(): void {
  if (appState.state !== "playing") return;
  const score = session.getScore();
  if (score === null) return;
  net.send({ type: "player_died", survivalTicks: score });
  transition("local_death");
}

net.onMessage(handleServer);

function handleServer(message: ServerMessage): void {
  switch (message.type) {
    case "welcome":
      myId = message.id;
      break;
    case "room_state":
      amHost = message.hostId === myId;
      session.setRoster(message.players, myId);
      if (isGameId(message.gameId)) selectedGameId = message.gameId;
      renderReady(message.code, message.players, message.hostId, myId);
      location.hash = message.code;
      if (message.state === "waiting") {
        if (appState.state === "lobby") transition("room_joined");
        else if (appState.state === "result") transition("return_ready");
      } else if (appState.state === "result" && finalRanks.length > 0) {
        renderResult(finalRanks, myId, amHost);
      }
      break;
    case "game_start":
      startCountdown(message.seed, message.startTime, message.gameId);
      break;
    case "peer_snapshot":
      session.applySnapshot(message.peers);
      break;
    case "peer_died":
      session.markPeerDead(message.id);
      break;
    case "ranking_update":
      setAliveHud(`생존 ${message.alive} / ${message.ranks.length}`);
      break;
    case "game_over":
      showResult(message.finalRanks);
      break;
    case "host_changed":
      amHost = message.newHostId === myId;
      if (appState.state === "result" && finalRanks.length > 0) renderResult(finalRanks, myId, amHost);
      break;
    case "error":
      toast(message.reason);
      break;
    case "time_sync_response":
      break;
  }
}

const RANDOM_NAMES = ["고수", "초심자", "바람", "그림자", "은둔자", "검객", "나그네"];
byId("nick-go").addEventListener("click", () => {
  const value = byId<HTMLInputElement>("nick-input").value.trim();
  myNickname = value || `${RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]}${Math.floor(Math.random() * 100)}`;
  byId("main-hello").textContent = `${myNickname} 님, 환영합니다`;
  transition("nickname_submit");
  tryAutoJoin();
});

byId("menu-start").addEventListener("click", () => {
  renderGameList(selectGame);
  transition("open_games");
});
byId("menu-options").addEventListener("click", () => toast("옵션은 준비 중입니다."));
byId("menu-credits").addEventListener("click", () => toast("Arcade — 결정론 동기화 웹 멀티 아케이드 프레임워크"));

function navTo(target: string | undefined): void {
  const event = target === "notice" ? "nav_notice"
    : target === "about" ? "nav_about"
      : target === "community" ? "nav_community"
        : myNickname ? "nav_game_main" : "nav_game_nickname";
  if (target === "notice") renderNotices();
  if (!transition(event)) toast("방을 나간 뒤 다른 페이지로 이동할 수 있습니다.");
}

document.querySelectorAll<HTMLElement>("[data-nav]").forEach((element) => {
  element.addEventListener("click", (event) => {
    event.preventDefault();
    navTo(element.dataset.nav);
  });
});
byId("footer-legal").addEventListener("click", () => toast("이용약관·개인정보는 준비 중입니다."));
byId("gamelist-back").addEventListener("click", () => transition("back_main"));

function selectGame(id: GameId): void {
  selectedGameId = id;
  renderLobby(id);
  transition("select_game");
}

byId("create-btn").addEventListener("click", () => {
  if (!selectedGameId || !ensureNetwork()) return;
  net.send({ type: "create_room", gameId: selectedGameId, nickname: myNickname });
});
byId("join-btn").addEventListener("click", () => {
  if (!ensureNetwork()) return;
  const code = byId<HTMLInputElement>("join-code").value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z]{4}$/.test(code)) return toast("유효한 방 코드 4자리를 입력하세요.");
  net.send({ type: "join_room", code, nickname: myNickname });
});
byId("lobby-back").addEventListener("click", () => transition("back_games"));
byId("start-btn").addEventListener("click", () => {
  if (ensureNetwork()) net.send({ type: "start_game" });
});
byId("leave-btn").addEventListener("click", leaveRoom);
byId("result-leave-btn").addEventListener("click", leaveRoom);

function leaveRoom(): void {
  net.send({ type: "leave_room" });
  session.leaveRoom();
  finalRanks = [];
  location.hash = "";
  transition("leave_room");
}

let countdownTimer = 0;
function startCountdown(seed: number, startTime: number, gameId: string): void {
  if (!isGameId(gameId)) return toast(`알 수 없는 게임입니다: ${gameId}`);
  if (!net.isClockSynchronized || !transition("game_start")) return;
  let lastNumber = -1;
  const update = (): void => {
    const remaining = startTime - net.getServerNow();
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      if (transition("countdown_done")) beginPlay(gameId, seed, startTime);
      return;
    }
    const number = Math.ceil(remaining / 1000);
    if (number === lastNumber) return;
    lastNumber = number;
    setCountdown(number);
  };
  clearInterval(countdownTimer);
  countdownTimer = window.setInterval(update, 50);
  update();
}

function beginPlay(gameId: string, seed: number, startTime: number): void {
  finalRanks = [];
  setAliveHud("생존 …");
  if (!session.start(gameId, seed, net.serverTimeToPerformance(startTime))) {
    toast(`게임을 시작할 수 없습니다: ${gameId}`);
  }
}

byId("death-stay-btn").addEventListener("click", () => {
  session.showOwnResult();
  transition("keep_result");
});
byId("death-watch-btn").addEventListener("click", () => {
  if (!session.watchRandomSurvivor()) return toast("관전할 생존자가 없습니다.");
  transition("watch");
});

window.setInterval(() => {
  if (appState.state !== "playing") return;
  const position = session.getPosition();
  if (position) net.send({ type: "player_state", px: position.x, py: position.y });
}, POSITION_SEND_MS);

function showResult(ranks: readonly RankEntry[]): void {
  if (!appState.can("game_over")) return;
  finalRanks = ranks;
  renderResult(ranks, myId, amHost);
  setAliveHud("", true);
  session.stopRound();
  transition("game_over");
}

byId("again-btn").addEventListener("click", () => net.send({ type: "return_to_ready" }));

const hashCode = location.hash.slice(1).toUpperCase();
let autoJoinPending = /^[A-HJ-NP-Z]{4}$/.test(hashCode);
function tryAutoJoin(): void {
  if (!autoJoinPending || !myNickname || !networkReady || appState.state !== "main") return;
  autoJoinPending = false;
  const defaultGame = Object.keys(GAME_REGISTRY)[0] as GameId;
  renderGameList(selectGame);
  transition("open_games");
  selectGame(defaultGame);
  byId<HTMLInputElement>("join-code").value = hashCode;
  net.send({ type: "join_room", code: hashCode, nickname: myNickname });
}

renderState(appState.state);
net.connect(WS_URL).then(() => {
  networkReady = true;
  tryAutoJoin();
}).catch(() => {
  toast("서버에 연결하거나 시각을 동기화할 수 없습니다. 'npm run dev:server'를 확인하세요.");
});
