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
  fallScreen,
  slideInScreen,
  swapSpectateScreen,
  resetScreenFx,
  setCountdown,
  setSideSlot,
  toast,
} from "./AppView";
import { GAME_REGISTRY, isGameId, type GameId } from "./GameRegistry";
import { GameSession } from "./GameSession";

/** 게임 좌표계(논리) 크기. 캔버스 픽셀 크기와 별개다 — 표시 크기는 CSS/DPR이 정하고,
 *  Canvas2DRenderer가 논리->픽셀 변환을 맡는다. 게임 로직은 항상 이 좌표만 본다. */
const LOGICAL_WIDTH = 800;
const LOGICAL_HEIGHT = 800; // 정사각형 — 원형 경기장에 맞춤(죽림고수 config와 일치).
const POSITION_SEND_MS = 100;

/** 게임 서버 주소(호스트까지만. 경로는 용도별로 붙인다).
 *  - 배포: VITE_WS_URL을 반드시 지정한다(예: wss://...). HTTPS 페이지에서 ws:// 로 붙으면
 *    브라우저가 mixed content로 차단하므로 wss:// 여야 한다.
 *  - 로컬 개발: 값이 없으면 같은 호스트의 8787(`npm run dev:edge`)로 붙는다. */
const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${location.hostname || "localhost"}:8787`;

/** 방 만들기만 HTTP다. WebSocket은 붙는 순간 방이 정해지므로(방 하나 = 서버 인스턴스 하나),
 *  "접속한 뒤 방을 만든다"가 불가능하다. 코드를 먼저 받고 그 코드로 접속한다.
 *  주소는 하나만 설정하면 되도록 ws→http, wss→https로 유도한다. */
const HTTP_URL = WS_URL.replace(/^ws/, "http");

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

/** 방에 연결된 상태인가. 서버 연결은 방에 들어갈 때 맺고 나올 때 끊는다
 *  — 앱 시작 시점에는 연결하지 않는다(연습 모드는 서버가 없어도 돌아간다). */
let inRoom = false;
let selectedGameId: GameId | null = null;
let myId: string | null = null;
let myNickname = "";
let amHost = false;
let finalRanks: readonly RankEntry[] = [];
/** 연습(싱글) 모드 여부. 서버를 한 번도 거치지 않는 라운드다 —
 *  사망·결과·재시작을 전부 로컬에서 처리하고, 네트워크 메시지를 보내지 않는다. */
let soloMode = false;
/** 연습 결과표에서 "나"를 가리키는 가짜 id. 서버가 준 실제 id와 절대 겹치지 않게 둔다. */
const SOLO_ID = "solo";

function transition(event: AppEvent): boolean {
  if (!appState.can(event)) return false;
  appState.transition(event);
  return true;
}

function ensureNetwork(): boolean {
  if (inRoom && net.isClockSynchronized) return true;
  toast("서버 연결과 시각 동기화가 아직 준비되지 않았습니다.");
  return false;
}

/** 낙하 연출 길이(ms). CSS #game.fallen 애니메이션(.8s)과 맞춘다. */
const FALL_MS = 800;
let fallTimer = 0;

function onLocalDeath(): void {
  if (appState.state !== "playing") return;
  const score = session.getScore();
  if (score === null) return;
  fallScreen(); // 내 화면이 아래로 떨어진다.
  // 연습은 죽는 순간이 곧 끝이다. 관전할 남도, 기다릴 서버도 없다.
  if (soloMode) return showSoloResult(score);
  net.send({ type: "player_died", survivalTicks: score });
  transition("local_death"); // → dying (카드 없음, 낙하만 재생)
  // 낙하가 끝나면 자동으로 관전 전환. 선택 화면은 없다.
  clearTimeout(fallTimer);
  fallTimer = window.setTimeout(autoSpectate, FALL_MS);
}

// 관전 중 ←/→로 다른 생존자로 넘긴다(대상 선택이 아니라 순환). e.repeat 무시 = 한 번 눌러 한 칸.
window.addEventListener("keydown", (event) => {
  if (appState.state !== "spectating" || event.repeat) return;
  const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (direction === 0) return;
  event.preventDefault();
  if (session.cycleSpectate(direction)) swapSpectateScreen(direction);
});

/** 낙하 후 살아있는 남의 화면으로 슬라이드 전환. 남이 없으면 결과를 기다린다. */
function autoSpectate(): void {
  if (appState.state !== "dying") return; // 그새 game_over가 왔으면 아무것도 안 한다.
  if (session.watchRandomSurvivor()) {
    slideInScreen(); // 남의 화면이 위에서 미끄러져 들어온다.
    transition("watch");
  } else {
    transition("keep_result"); // 관전할 생존자가 없다 — 떨어진 내 화면 그대로 결과를 기다린다.
  }
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
byId("menu-credits").addEventListener("click", () => toast("Arcade — 웹 멀티 아케이드 게임"));

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

/* ---- 연습(싱글) 모드 -------------------------------------------------------
   서버를 전혀 쓰지 않는다. 시드를 로컬에서 뽑고, 지금 이 순간을 tick 0으로 삼는다.
   게임 코드는 멀티와 완전히 동일하다 — 결정론 코어가 시드만 다르게 돌 뿐이다.
   덕분에 서버가 자고 있어도, 친구가 없어도 게임을 할 수 있다. */

/** 라운드 시드. 게임 로직이 아니라 "시드 고르기"라 Math.random을 써도 결정론과 무관하다
 *  (서버도 같은 일을 한다). 이 시드가 정해진 뒤로는 모든 것이 시드와 tick에서만 파생된다. */
function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function startSolo(): void {
  if (!selectedGameId) return;
  if (!transition("start_solo")) return;
  soloMode = true;
  finalRanks = [];
  resetScreenFx(); // 떨어졌던 화면을 제자리로.
  session.setRoster([], null); // 남이 없다 → peer도, 관전 뷰도 없다.
  setAliveHud("연습");
  if (!session.start(selectedGameId, randomSeed(), performance.now())) {
    toast(`게임을 시작할 수 없습니다: ${selectedGameId}`);
  }
}

function showSoloResult(score: number): void {
  if (!transition("game_over")) return;
  finalRanks = [{ id: SOLO_ID, rank: 1, nickname: myNickname, survivalTicks: score }];
  // amHost=true로 넘겨 "다시 하기"를 보이게 한다(연습은 언제나 내가 방장이다).
  renderResult(finalRanks, SOLO_ID, true);
  setAliveHud("", true);
  session.stopRound();
}

byId("solo-btn").addEventListener("click", startSolo);

/** 방 코드로 접속하고 참가까지 마친다.
 *  ⚠️ 서버는 방마다 인스턴스가 따로다(Durable Object). 그래서 "접속 후 방 선택"이 아니라
 *     "방을 정하고 접속"하는 순서다. 방을 옮기려면 연결부터 새로 맺어야 한다. */
async function enterRoom(code: string): Promise<void> {
  try {
    await net.connect(`${WS_URL}/ws?code=${code}`);
  } catch {
    inRoom = false;
    return toast("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  }
  inRoom = true;
  net.send({ type: "join_room", code, nickname: myNickname });
}

byId("create-btn").addEventListener("click", () => {
  // 클릭 시점의 선택을 고정한다 — 아래는 비동기라, 그 사이 선택이 바뀌면 엉뚱한 방이 생긴다.
  const gameId = selectedGameId;
  if (!gameId) return;
  // 방 만들기는 HTTP로 코드를 먼저 받는다 — WebSocket은 붙는 순간 방이 정해지므로
  // 방이 없는 상태로는 접속할 곳이 없다.
  void (async () => {
    let code: string;
    try {
      const response = await fetch(`${HTTP_URL}/rooms?gameId=${encodeURIComponent(gameId)}`, { method: "POST" });
      if (!response.ok) return toast("방을 만들 수 없습니다. 잠시 후 다시 시도해 주세요.");
      ({ code } = (await response.json()) as { code: string });
    } catch {
      return toast("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }
    await enterRoom(code);
  })();
});
byId("join-btn").addEventListener("click", () => {
  const code = byId<HTMLInputElement>("join-code").value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z]{4}$/.test(code)) return toast("유효한 방 코드 4자리를 입력하세요.");
  void enterRoom(code);
});
byId("lobby-back").addEventListener("click", () => transition("back_games"));
byId("start-btn").addEventListener("click", () => {
  if (ensureNetwork()) net.send({ type: "start_game" });
});
byId("leave-btn").addEventListener("click", leaveRoom);
byId("result-leave-btn").addEventListener("click", leaveRoom);

function leaveRoom(): void {
  if (!soloMode) {
    net.send({ type: "leave_room" }); // 연습은 애초에 방이 없다.
    // 연결은 방에 매여 있다 — 방을 나가면 소켓도 닫는다. 다음 방은 새로 연결한다.
    net.close();
    inRoom = false;
    myId = null;
  }
  soloMode = false;
  clearTimeout(fallTimer);
  resetScreenFx(); // 로비로 나가니 다음 판을 위해 복구.
  session.leaveRoom();
  finalRanks = [];
  location.hash = "";
  transition("leave_room");
}

let countdownTimer = 0;
function startCountdown(seed: number, startTime: number, gameId: string): void {
  if (!isGameId(gameId)) return toast(`알 수 없는 게임입니다: ${gameId}`);
  if (!net.isClockSynchronized || !transition("game_start")) return;
  slideInScreen(); // 카운트다운 3초 동안 게임판이 위에서 내려와 자리잡는다(0.55s).
  session.showReadyFrame(gameId, seed); // 내려오는 판에 원형 경기장을 미리 그려둔다.
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
  resetScreenFx(); // 새 라운드 — 떨어졌던 화면 복구.
  setAliveHud("생존 …");
  if (!session.start(gameId, seed, net.serverTimeToPerformance(startTime))) {
    toast(`게임을 시작할 수 없습니다: ${gameId}`);
  }
}

window.setInterval(() => {
  if (soloMode || appState.state !== "playing") return; // 연습: 내 위치를 볼 남이 없다.
  const position = session.getPosition();
  if (position) net.send({ type: "player_state", px: position.x, py: position.y });
}, POSITION_SEND_MS);

function showResult(ranks: readonly RankEntry[]): void {
  if (!appState.can("game_over")) return;
  clearTimeout(fallTimer); // 낙하 중 게임이 끝났으면 관전 전환을 취소한다.
  finalRanks = ranks;
  renderResult(ranks, myId, amHost);
  setAliveHud("", true);
  session.stopRound();
  transition("game_over");
}

byId("again-btn").addEventListener("click", () => {
  // 연습: 대기실이 없으므로 새 시드로 곧장 다시 시작한다. 멀티: 호스트가 전원을 대기실로.
  if (soloMode) return startSolo();
  net.send({ type: "return_to_ready" });
});

const hashCode = location.hash.slice(1).toUpperCase();
let autoJoinPending = /^[A-HJ-NP-Z]{4}$/.test(hashCode);
function tryAutoJoin(): void {
  if (!autoJoinPending || !myNickname || appState.state !== "main") return;
  autoJoinPending = false;
  const defaultGame = Object.keys(GAME_REGISTRY)[0] as GameId;
  renderGameList(selectGame);
  transition("open_games");
  selectGame(defaultGame);
  byId<HTMLInputElement>("join-code").value = hashCode;
  void enterRoom(hashCode);
}

// 시작 시점에는 서버에 연결하지 않는다. 연결은 방에 들어갈 때 맺는다
// — 덕분에 서버가 자고 있어도 연습 모드는 그대로 돌아간다.
renderState(appState.state);
