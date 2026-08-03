import { NetClient, StateMachine } from "@arcade/core";
import type { RankEntry, ServerMessage } from "@arcade/shared";
import { formatTicks } from "@arcade/shared";
import { APP_TRANSITIONS, type AppEvent, type AppState } from "./AppFlow";
import { initAudio, play } from "./audio";
import { initBgDecor } from "./bgDecor";
import {
  renderGameList,
  renderLobby,
  renderNotices,
  renderRanking,
  renderRankingTabs,
  renderReady,
  renderResult,
  renderState,
  setAliveHud,
  setSideSlot,
  toast,
} from "./AppView";
import { cancelCountdown, runCountdown } from "./countdown";
import { byId } from "./dom";
import { layoutPlayArea } from "./playLayout";
import { ROOM_CODE_PATTERN, createRoom, joinRoom } from "./roomConnect";
import { initSoundShell } from "./soundShell";
import {
  bulletFx,
  deathFx,
  debuffFx,
  fallScreen,
  resetScreenFx,
  slideInScreen,
  swapSpectateScreen,
} from "./screenFx";
import { GAME_REGISTRY, isGameId, type GameId } from "./GameRegistry";
import { GameSession } from "./GameSession";
import { recordBest } from "./personalBest";
import { loadNickname, saveNickname } from "./prefs";
import { fetchBoard, submitScore, takeTicket, type SoloTicket } from "./soloRanking";

/** 게임 좌표계(논리) 크기. 캔버스 픽셀 크기와 별개다 — 표시 크기는 CSS/DPR이 정하고,
 *  Canvas2DRenderer가 논리->픽셀 변환을 맡는다. 게임 로직은 항상 이 좌표만 본다. */
const LOGICAL_WIDTH = 800;
const LOGICAL_HEIGHT = 800; // 정사각형 — 원형 경기장에 맞춤(죽림고수 config와 일치).
const POSITION_SEND_MS = 100;
/** 카운트다운 길이(ms). 멀티는 서버가 이 값으로 startTime을 잡고, 솔로는 로컬로 센다. */
const COUNTDOWN_MS = 3000;

const mainCanvas = byId<HTMLCanvasElement>("game");
const sideCanvases = Array.from({ length: 3 }, (_, index) => byId<HTMLCanvasElement>(`side-${index}`));

const appState = new StateMachine<AppState, AppEvent>("nickname", APP_TRANSITIONS, ({ to }) => renderState(to));
const net = new NetClient();
const session = new GameSession({
  mainCanvas,
  sideCanvases,
  touchHint: byId("touch-zones"),
  stick: byId("stick"),
  stickKnob: byId("stick-knob"),
  dpad: byId("dpad"),
  logicalWidth: LOGICAL_WIDTH,
  logicalHeight: LOGICAL_HEIGHT,
  onLocalDeath,
  onSideSlot: setSideSlot,
  onHud: updateHud,
  // 조작 영역이 생기거나 사라지면 판이 쓸 세로가 달라진다 — 판 크기를 다시 잡는다.
  onControlsChange: () => relayout(),
  // 서버로 조준 발사를 보내고, 내 화면에는 그 관전창으로 탄환이 날아가 명중하는 연출을 건다.
  onFire: (kind, durationMs, targetId, slotIndex) => {
    net.send({ type: "fire_effect", kind, durationMs, targetId });
    bulletFx(slotIndex, kind);
  },
});

/** 매 프레임 로컬 플레이어 HUD 갱신 — 캔버스 밖 좌측 상단 헤더(시간 + 스릴 게이지).
 *  gauge가 null이면(getGauge를 구현 안 한 게임) 게이지 줄을 숨긴다. */
function updateHud(score: number, gauge: number | null): void {
  byId("hud-time").textContent = formatTicks(score);
  const gaugeEl = byId("hud-gauge");
  if (gauge === null) {
    gaugeEl.hidden = true;
    return;
  }
  gaugeEl.hidden = false;
  const clamped = Math.max(0, Math.min(1, gauge));
  const fill = byId("hud-gauge-fill");
  fill.style.width = `${clamped * 100}%`;
  fill.classList.toggle("near", clamped >= 0.85);
}
/** 표시 크기를 먼저 정하고(레이아웃), 그 크기에 맞춰 캔버스 해상도를 잡는다(렌더러). 순서 중요. */
function relayout(): void {
  layoutPlayArea(LOGICAL_WIDTH / LOGICAL_HEIGHT);
  session.resizeViews();
}
relayout();
// 창 크기·모니터(DPR) 변경 시 다시 맞춘다.
window.addEventListener("resize", relayout);
// 폰을 눕히면 resize보다 orientationchange가 먼저 오거나, iOS에서는 resize 시점의
// innerWidth가 아직 회전 전 값인 경우가 있다. 한 번 더 맞춰 두면 어느 쪽이든 맞는다.
window.addEventListener("orientationchange", () => setTimeout(relayout, 0));

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
/** 이번 연습 판의 랭킹 티켓. null이면 서버 없이 시작한 판이라 기록을 낼 수 없다. */
let soloTicket: string | null = null;
/** 연습 판 일련번호. 늦게 도착한 순위 응답이 **다음 판** 결과창에 끼어드는 걸 막는다. */
let soloRound = 0;

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
  deathFx(); // 화면 흔들림 + 붉은 섬광(임팩트).
  play("death"); // 떨어지는 세 음 — 흔들림·섬광과 같은 순간에 얹힌다.
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
        renderResult(finalRanks, myId, amHost, soloMode);
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
    case "effect_hit":
      // 누군가 스릴 게이지를 채워 나를 조준해 방해 디버프를 쐈다. 살아서 플레이 중일 때만
      // 게임에 적용하고, 같은 조건에서 화면 연출(배너 + 시각 디버프)도 함께 건다.
      // 소리는 게임 계약을 안 거친다 — 이건 네트워크에서 온 사건이라 앱이 이미 안다.
      if (session.applyEffect(message.kind, message.durationMs)) {
        play("hit");
        debuffFx(message.kind, message.durationMs);
      }
      break;
    case "ranking_update":
      setAliveHud(`생존 ${message.alive} / ${message.ranks.length}`);
      break;
    case "game_over":
      showResult(message.finalRanks);
      break;
    case "host_changed":
      amHost = message.newHostId === myId;
      if (appState.state === "result" && finalRanks.length > 0) renderResult(finalRanks, myId, amHost, soloMode);
      break;
    case "error":
      toast(message.reason);
      break;
    case "time_sync_response":
      break;
  }
}

const RANDOM_NAMES = ["고수", "초심자", "바람", "그림자", "은둔자", "검객", "나그네"];
// 지난 방문에 쓴 닉네임을 입력칸에 미리 채운다(매번 다시 안 치게).
byId<HTMLInputElement>("nick-input").value = loadNickname();

byId("nick-go").addEventListener("click", () => {
  const value = byId<HTMLInputElement>("nick-input").value.trim();
  myNickname = value || `${RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]}${Math.floor(Math.random() * 100)}`;
  saveNickname(myNickname); // 랜덤으로 정해진 이름도 기억해 다음에 이어 쓴다.
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
        : target === "ranking" ? "nav_ranking"
          : myNickname ? "nav_game_main" : "nav_game_nickname";
  if (target === "notice") renderNotices();
  if (!transition(event)) return toast("방을 나간 뒤 다른 페이지로 이동할 수 있습니다.");
  // 화면이 실제로 열렸을 때만 불러온다 — 방 안에서 막힌 경우에는 부를 필요가 없다.
  if (target === "ranking") void openRanking(rankingGameId ?? selectedGameId ?? FIRST_GAME_ID);
}

/* ---- 순위 화면 -------------------------------------------------------------
   서버에 저장된 혼자 플레이 기록을 게임별로 보여준다. 여는 순간 한 번 불러오고,
   탭을 바꿀 때마다 다시 불러온다(캐시하지 않는다 — 남이 방금 세운 기록이 안 보이는
   것보다 매번 한 번 더 부르는 쪽이 낫다). */

const FIRST_GAME_ID = Object.keys(GAME_REGISTRY)[0] as GameId;
/** 순위 화면에서 보고 있는 게임. 게임을 고른 적이 있으면 그 게임으로 연다. */
let rankingGameId: GameId | null = null;

async function openRanking(gameId: GameId): Promise<void> {
  rankingGameId = gameId;
  renderRankingTabs(gameId, (id) => void openRanking(id));
  renderRanking({ state: "loading" }, myNickname);
  const rows = await fetchBoard(gameId);
  // 기다리는 동안 다른 탭을 눌렀거나 화면을 떠났으면 늦게 온 목록을 그리지 않는다.
  if (rankingGameId !== gameId || appState.state !== "ranking") return;
  renderRanking(rows ? { state: "ready", rows } : { state: "failed" }, myNickname);
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
  prefetchTicket(id); // 여기서 다음 행동은 대개 "연습"이다 — 미리 받아 둔다.
}

/* ---- 연습(싱글) 모드 -------------------------------------------------------
   방도 상대도 없다. 사망·결과·재시작을 전부 로컬에서 처리하고, 게임 코드는 멀티와
   완전히 동일하다 — 결정론 코어가 시드만 다르게 돌 뿐이다.

   서버와는 딱 두 번, 그것도 **없어도 되는** 방식으로 만난다. 시작할 때 랭킹 티켓을
   받고(실패하면 로컬 시드로 그냥 논다), 죽으면 기록을 낸다(실패하면 그냥 안 올라간다).
   그래서 서버가 자고 있어도, 친구가 없어도 게임은 된다. */

/** 라운드 시드. 게임 로직이 아니라 "시드 고르기"라 Math.random을 써도 결정론과 무관하다
 *  (서버도 같은 일을 한다). 이 시드가 정해진 뒤로는 모든 것이 시드와 tick에서만 파생된다.
 *  ⚠️ 이 시드로 시작한 판은 **랭킹에 올라가지 않는다** — 서버가 발급하지 않은 판이라
 *     기록을 묶을 티켓이 없다. */
function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** 미리 받아 둔 티켓. **버튼을 누른 뒤에** 서버를 왕복하면 그 시간만큼 판이 늦게 뜬다 —
 *  서버가 죽어 있을 때는 시간 초과를 다 기다려 2초 넘게 멈추는 게 실제로 측정됐다.
 *  그래서 "연습을 누를 것 같은 시점"(게임 선택·결과 화면)에 미리 받아 둔다. 안 쓴 티켓은
 *  버려도 아무 비용이 없다 — 서버는 발급을 저장하지 않고, 쓴 티켓만 기억한다. */
let pendingTicket: { gameId: GameId; promise: Promise<SoloTicket | null> } | null = null;

function prefetchTicket(gameId: GameId): void {
  pendingTicket = { gameId, promise: takeTicket(gameId) };
}

/** 미리 받아 둔 게 있으면 그걸 쓰고, 없으면(다른 게임이거나 이미 썼으면) 지금 받는다. */
function claimTicket(gameId: GameId): Promise<SoloTicket | null> {
  const pending = pendingTicket?.gameId === gameId ? pendingTicket.promise : takeTicket(gameId);
  pendingTicket = null; // 티켓 하나로 한 판. 다음 판은 다시 받는다.
  return pending;
}

/** 티켓을 받는 동안 시작 버튼이 다시 눌리는 걸 막는다(왕복이 있어 즉시 시작이 아니다). */
let soloStarting = false;

async function startSolo(): Promise<void> {
  const gameId = selectedGameId;
  if (!gameId || soloStarting) return;

  // 랭킹 도전 판의 시드는 서버가 준다 — 그래야 기록이 이 한 판에 묶이고, 쉬운 시드가
  // 나올 때까지 다시 뽑을 수 없다. 서버가 자고 있으면 짧게 포기하고 로컬 시드로 논다.
  soloStarting = true;
  const ticket = await claimTicket(gameId);
  soloStarting = false;

  if (!transition("start_solo")) return; // → countdown (기다리는 사이 화면을 떠났을 수 있다)
  soloMode = true;
  soloTicket = ticket?.ticket ?? null;
  soloRound++; // 지난 판의 늦은 순위 응답은 이 시점부터 무시된다.
  finalRanks = [];
  session.setRoster([], null); // 남이 없다 → peer도, 관전 뷰도 없다.
  setAliveHud("혼자 플레이");
  // 멀티처럼 카운트다운 3초 뒤 시작. 멀티는 서버시각 기준이지만 솔로는 서버가
  // 없으므로 로컬시각으로 센다. 시드도 여기서 정해 카운트다운/플레이가 공유한다.
  const seed = ticket?.seed ?? randomSeed();
  slideInScreen(); // 카운트다운 동안 게임판이 위에서 내려와 자리잡는다.
  session.showReadyFrame(gameId, seed); // 내려오는 판에 경기장을 미리 그려둔다.
  // 솔로는 서버가 없으므로 로컬시각으로 센다(멀티는 서버시각 — 재는 방법만 다르다).
  const start = performance.now();
  runCountdown(() => COUNTDOWN_MS - (performance.now() - start), () => {
    if (!transition("countdown_done")) return;
    resetScreenFx(); // 새 라운드 — 떨어졌던 화면 복구.
    play("go");
    updateHud(0, null); // 지난 판 숫자가 첫 프레임에 잠깐 비치지 않게.
    setAliveHud("혼자 플레이");
    if (!session.start(gameId, seed, performance.now())) {
      toast(`게임을 시작할 수 없습니다: ${gameId}`);
    }
  });
}

/** ⚠️ 여기서는 결과음을 내지 않는다 — onLocalDeath가 같은 프레임에 부르므로
 *  사망음 위에 겹친다. 연습에서 판이 끝났다는 신호는 사망음 하나로 충분하다. */
function showSoloResult(score: number): void {
  if (!transition("game_over")) return;
  finalRanks = [{ id: SOLO_ID, rank: 1, nickname: myNickname, survivalTicks: score }];
  // amHost=true로 넘겨 "다시 하기"를 보이게 한다(연습은 언제나 내가 방장이다).
  renderResult(finalRanks, SOLO_ID, true, true);
  // 연습은 순위(1위)가 의미 없다 — 그 자리에 개인 최고기록을 보여준다.
  if (selectedGameId) {
    const { best, isNew } = recordBest(selectedGameId, score);
    byId("result-sub").textContent = `${isNew ? "새 기록! " : ""}최고 ${formatTicks(best)}`;
  }
  submitSoloScore(score);
  // 여기서 가장 흔한 다음 행동은 "다시 하기"다 — 결과를 보는 동안 다음 티켓을 받아 둔다.
  if (selectedGameId) prefetchTicket(selectedGameId);
  setAliveHud("", true);
  session.stopRound();
}

/** 랭킹 도전 판이었다면 기록을 낸다.
 *
 *  ⚠️ 기다리지 않는다. 결과창은 이미 떠 있고, 전체 등수는 도착하는 대로 뒤에 붙는다 —
 *     서버 응답 때문에 결과창이 늦게 뜨면 죽은 순간과 화면이 어긋난다. */
function submitSoloScore(score: number): void {
  const ticket = soloTicket;
  soloTicket = null; // 티켓은 일회용 — 같은 판에서 두 번 내지 않는다.
  if (!ticket || !myNickname) return;

  const round = soloRound;
  void (async () => {
    const result = await submitScore(ticket, myNickname, score);
    // 늦게 왔다. 그새 다음 판이 시작했으면 지금 결과창은 남의 판 것이다.
    if (!result || result.rank === null || round !== soloRound) return;
    if (appState.state !== "result") return;
    byId("result-sub").textContent += ` · 전체 ${result.rank}위`;
  })();
}

byId("solo-btn").addEventListener("click", () => void startSolo());

async function enterRoom(code: string): Promise<void> {
  inRoom = await joinRoom(net, code, myNickname);
  if (!inRoom) toast("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
}

byId("create-btn").addEventListener("click", () => {
  // 클릭 시점의 선택을 고정한다 — 아래는 비동기라, 그 사이 선택이 바뀌면 엉뚱한 방이 생긴다.
  const gameId = selectedGameId;
  if (!gameId) return;
  void (async () => {
    const code = await createRoom(gameId);
    if (!code) return toast("방을 만들 수 없습니다. 잠시 후 다시 시도해 주세요.");
    await enterRoom(code);
  })();
});
byId("join-btn").addEventListener("click", () => {
  const code = byId<HTMLInputElement>("join-code").value.trim().toUpperCase();
  if (!ROOM_CODE_PATTERN.test(code)) return toast("유효한 방 코드 4자리를 입력하세요.");
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
  cancelCountdown(); // 카운트다운 중에 나갔을 수 있다 — 숫자와 소리가 계속 돌면 안 된다.
  resetScreenFx(); // 로비로 나가니 다음 판을 위해 복구.
  session.leaveRoom();
  finalRanks = [];
  location.hash = "";
  transition("leave_room");
}

function startCountdown(seed: number, startTime: number, gameId: string): void {
  if (!isGameId(gameId)) return toast(`알 수 없는 게임입니다: ${gameId}`);
  if (!net.isClockSynchronized || !transition("game_start")) return;
  slideInScreen(); // 카운트다운 3초 동안 게임판이 위에서 내려와 자리잡는다(0.55s).
  session.showReadyFrame(gameId, seed); // 내려오는 판에 원형 경기장을 미리 그려둔다.
  // 멀티는 **서버시각** 기준이다 — 각자의 로컬시각으로 세면 시작 tick이 어긋난다.
  runCountdown(() => startTime - net.getServerNow(), () => {
    if (transition("countdown_done")) beginPlay(gameId, seed, startTime);
  });
}

function beginPlay(gameId: string, seed: number, startTime: number): void {
  finalRanks = [];
  resetScreenFx(); // 새 라운드 — 떨어졌던 화면 복구.
  play("go");
  updateHud(0, null); // 지난 판 숫자가 첫 프레임에 잠깐 비치지 않게.
  setAliveHud("생존 …");
  if (!session.start(gameId, seed, net.serverTimeToPerformance(startTime))) {
    toast(`게임을 시작할 수 없습니다: ${gameId}`);
  }
}

window.setInterval(() => {
  if (soloMode || appState.state !== "playing") return; // 연습: 내 위치를 볼 남이 없다.
  const position = session.getPosition();
  if (!position) return;
  // 게임이 낸 시각 이벤트(예: 정화 파동)를 위치에 얹어 보낸다 — 서버는 의미를 모르고
  // 다음 스냅샷에 한 번 실어 중계한다. 없으면 필드 자체를 안 붙인다.
  const ev = session.takePeerEvent();
  net.send(ev === null
    ? { type: "player_state", px: position.x, py: position.y }
    : { type: "player_state", px: position.x, py: position.y, ev });
}, POSITION_SEND_MS);

function showResult(ranks: readonly RankEntry[]): void {
  if (!appState.can("game_over")) return;
  clearTimeout(fallTimer); // 낙하 중 게임이 끝났으면 관전 전환을 취소한다.
  finalRanks = ranks;
  // 판이 끝났다는 마침표. 멀티에서만 낸다 — 연습은 죽는 순간이 곧 결과라
  // 사망음과 같은 프레임에 겹쳐 둘 다 뭉개진다(showSoloResult 참조).
  play("result");
  renderResult(ranks, myId, amHost, soloMode);
  setAliveHud("", true);
  session.stopRound();
  transition("game_over");
}

byId("again-btn").addEventListener("click", () => {
  // 연습: 대기실이 없으므로 새 시드로 곧장 다시 시작한다. 멀티: 호스트가 전원을 대기실로.
  if (soloMode) return void startSolo();
  net.send({ type: "return_to_ready" });
});

const hashCode = location.hash.slice(1).toUpperCase();
let autoJoinPending = /^[A-HJ-NP-Z]{4}$/.test(hashCode);
function tryAutoJoin(): void {
  if (!autoJoinPending || !myNickname || appState.state !== "main") return;
  autoJoinPending = false;
  renderGameList(selectGame);
  transition("open_games");
  selectGame(FIRST_GAME_ID);
  byId<HTMLInputElement>("join-code").value = hashCode;
  void enterRoom(hashCode);
}

initBgDecor(document.querySelector<HTMLElement>(".bg-spot")!);
initAudio(); // 저장된 소리 설정을 읽는다. AudioContext는 첫 클릭 때 만들어진다.
initSoundShell(); // 소리 토글 버튼 + 클릭음 위임(앱 상태와 무관한 껍데기).

// 시작 시점에는 서버에 연결하지 않는다. 연결은 방에 들어갈 때 맺는다
// — 덕분에 서버가 자고 있어도 연습 모드는 그대로 돌아간다.
renderState(appState.state);
