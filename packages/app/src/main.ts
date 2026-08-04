import { NetClient, StateMachine } from "@arcade/core";
import type { RankEntry, ServerMessage } from "@arcade/shared";
import { APP_TRANSITIONS, type AppEvent, type AppState } from "./AppFlow";
import { initAudio, play } from "./audio";
import { initBgDecor } from "./bgDecor";
import {
  renderGameList,
  renderLobby,
  renderNotices,
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
import { GAME_REGISTRY, formatGameScore, gameEntry, isGameId, type GameId } from "./GameRegistry";
import { GameSession } from "./GameSession";
import { loadNickname, saveNickname } from "./prefs";
import { createRankingScreen } from "./rankingScreen";
import { createSoloPlay } from "./soloPlay";

/** 게임 좌표계(논리) 크기. 캔버스 픽셀 크기와 별개다 — 표시 크기는 CSS/DPR이 정하고,
 *  Canvas2DRenderer가 논리->픽셀 변환을 맡는다. 게임 로직은 항상 이 좌표만 본다. */
const LOGICAL_WIDTH = 800;
const LOGICAL_HEIGHT = 800; // 정사각형 — 원형 경기장에 맞춤(죽림고수 config와 일치).
const POSITION_SEND_MS = 100;

const mainCanvas = byId<HTMLCanvasElement>("game");
const sideCanvases = Array.from({ length: 3 }, (_, index) => byId<HTMLCanvasElement>(`side-${index}`));

const appState = new StateMachine<AppState, AppEvent>("nickname", APP_TRANSITIONS, ({ to }) => {
  renderState(to);
  syncRankingHash(to);
});

/** 순위 화면만 주소에 남긴다 — 링크로 보낼 수 있게. 방 코드 자동 참가(#ABCD)와는
 *  글자가 겹치지 않고, replaceState라 뒤로 가기 기록을 더럽히지 않는다. */
function syncRankingHash(state: AppState): void {
  const want = state === "ranking" ? "#ranking" : "";
  if (location.hash === want) return;
  history.replaceState(null, "", want || location.pathname + location.search);
}
const net = new NetClient();
const session = new GameSession({
  mainCanvas,
  sideCanvases,
  touchHint: byId("touch-zones"),
  stick: byId("stick"),
  stickKnob: byId("stick-knob"),
  dpad: byId("dpad"),
  keypad: byId("keypad"),
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

/** 매 프레임 로컬 플레이어 HUD 갱신 — 캔버스 밖 좌측 상단 헤더(기록 + 게이지).
 *  gauge가 null이면(getGauge를 구현 안 한 게임) 게이지 줄을 숨긴다.
 *  ⚠️ 기록 표기와 게이지 이름은 **게임마다 다르다.** 앞의 셋은 생존시간과 「스릴」,
 *  숫자 야구는 점수와 「남은 시간」이다 — 둘 다 레지스트리에서 온다. */
function updateHud(score: number, gauge: number | null): void {
  byId("hud-time").textContent = formatGameScore(selectedGameId, score);
  const gaugeEl = byId("hud-gauge");
  if (gauge === null) {
    gaugeEl.hidden = true;
    return;
  }
  gaugeEl.hidden = false;
  const entry = selectedGameId ? gameEntry(selectedGameId) : null;
  // 매 프레임 부르는 자리라 값이 그대로면 DOM을 안 건드린다.
  const label = entry?.gaugeLabel ?? "게이지";
  const labelEl = byId("hud-gauge-label");
  if (labelEl.textContent !== label) labelEl.textContent = label;
  const clamped = Math.max(0, Math.min(1, gauge));
  const fill = byId("hud-gauge-fill");
  fill.style.width = `${clamped * 100}%`;
  // 게이지가 뜻하는 바가 게임마다 반대다 — 커브는 **차면** 발사고, 숫자 야구는
  // **비면** 끝이다. 경고색은 "지금 중요한 순간"에 붙어야 하므로 방향도 게임이 정한다.
  fill.classList.toggle("near", entry?.gaugeAlarm === "empty" ? clamped <= 0.15 : clamped >= 0.85);
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
 *  — 앱 시작 시점에는 연결하지 않는다(혼자 플레이는 서버가 없어도 돌아간다). */
let inRoom = false;
let selectedGameId: GameId | null = null;
let myId: string | null = null;
let myNickname = "";
let amHost = false;
let finalRanks: readonly RankEntry[] = [];
/** 혼자 플레이 모드 여부. 서버를 한 번도 거치지 않는 라운드다 —
 *  사망·결과·재시작을 전부 로컬에서 처리하고, 네트워크 메시지를 보내지 않는다. */
let soloMode = false;

function transition(event: AppEvent): boolean {
  if (!appState.can(event)) return false;
  appState.transition(event);
  return true;
}

/* 한 판의 흐름과 순위 화면은 각자 자기 상태를 들고 있어 따로 산다(티켓·판 일련번호·
   보던 게임). main은 그 둘을 앱 상태에 이어 주는 일만 한다. */

const solo = createSoloPlay({
  session,
  transition,
  isResultOpen: () => appState.state === "result",
  nickname: () => myNickname,
  onStarted: () => {
    soloMode = true;
    finalRanks = [];
  },
  setRanks: (ranks) => {
    finalRanks = ranks;
  },
  resetHud: () => updateHud(0, null),
});

const ranking = createRankingScreen({
  isOpen: () => appState.state === "ranking",
  nickname: () => myNickname,
});

function startSolo(): void {
  if (selectedGameId) void solo.start(selectedGameId);
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
  // 혼자 하면 죽는 순간이 곧 끝이다. 관전할 남도, 기다릴 서버도 없다.
  if (soloMode) return solo.finish(selectedGameId, score);
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
        renderResult(finalRanks, myId, amHost, soloMode, selectedGameId);
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
      if (appState.state === "result" && finalRanks.length > 0) renderResult(finalRanks, myId, amHost, soloMode, selectedGameId);
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
  // ⚠️ 방에 있는 동안은 읽을거리로 새지 않는다. FSM만으로는 못 막는다 — 결과 화면에서
  //    순위표로 가는 길을 열어 뒀는데(혼자 플레이용), 그 길이 멀티에서도 열려 있으면
  //    남은 사람들의 다음 판 시작 신호를 놓친 채 방을 떠나게 된다.
  if (inRoom && target !== "game") return toast("방을 나간 뒤 다른 페이지로 이동할 수 있습니다.");
  if (target === "notice") renderNotices();
  if (!transition(event)) return toast("방을 나간 뒤 다른 페이지로 이동할 수 있습니다.");
  // 화면이 실제로 열렸을 때만 불러온다 — 막힌 경우에는 부를 필요가 없다.
  // 헤더로 열면 마지막에 보던 게임으로 돌아간다(없으면 고른 게임, 그것도 없으면 첫 게임).
  if (target === "ranking") ranking.show(ranking.lastViewed() ?? selectedGameId ?? FIRST_GAME_ID);
}

/** 특정 게임의 순위표로 곧장 간다(로비·결과 화면의 곁길). 헤더 내비와 달리
 *  **보던 게임을 지정**한다 — 방금 한 판의 순위가 궁금한 것이지 지난번에 본
 *  게임의 순위가 궁금한 게 아니다. */
function goRanking(gameId: GameId): void {
  if (!transition("nav_ranking")) return;
  ranking.show(gameId);
}

const FIRST_GAME_ID = Object.keys(GAME_REGISTRY)[0] as GameId;

document.querySelectorAll<HTMLElement>("[data-nav]").forEach((element) => {
  element.addEventListener("click", (event) => {
    event.preventDefault();
    navTo(element.dataset.nav);
  });
});
byId("lobby-rank-btn").addEventListener("click", () => goRanking(selectedGameId ?? FIRST_GAME_ID));
byId("result-rank-btn").addEventListener("click", () => goRanking(selectedGameId ?? FIRST_GAME_ID));
byId("footer-legal").addEventListener("click", () => toast("이용약관·개인정보는 준비 중입니다."));
byId("gamelist-back").addEventListener("click", () => transition("back_main"));

function selectGame(id: GameId): void {
  selectedGameId = id;
  renderLobby(id);
  transition("select_game");
  solo.prefetch(id); // 여기서 다음 행동은 대개 "혼자 플레이"다 — 티켓을 미리 받아 둔다.
}

byId("solo-btn").addEventListener("click", startSolo);

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
  // 지금까지의 기록도 함께 보낸다. 판이 끝나면 player_died가 최종값을 내지만, **끊기면
  // 그게 안 온다** — 그때 서버가 쓸 값이 이것이다(Room.disconnectMember 주석 참조).
  const sc = session.getScore();
  net.send({
    type: "player_state",
    px: position.x,
    py: position.y,
    ...(ev === null ? {} : { ev }),
    ...(sc === null ? {} : { sc: Math.max(0, Math.floor(sc)) }),
  });
}, POSITION_SEND_MS);

function showResult(ranks: readonly RankEntry[]): void {
  if (!appState.can("game_over")) return;
  clearTimeout(fallTimer); // 낙하 중 게임이 끝났으면 관전 전환을 취소한다.
  finalRanks = ranks;
  // 판이 끝났다는 마침표. 멀티에서만 낸다 — 혼자 할 때는 죽는 순간이 곧 결과라
  // 사망음과 같은 프레임에 겹쳐 둘 다 뭉개진다(soloPlay.finish 참조).
  play("result");
  renderResult(ranks, myId, amHost, soloMode, selectedGameId);
  setAliveHud("", true);
  session.stopRound();
  transition("game_over");
}

byId("again-btn").addEventListener("click", () => {
  // 혼자: 대기실이 없으므로 새 시드로 곧장 다시 시작한다. 멀티: 호스트가 전원을 대기실로.
  if (soloMode) return startSolo();
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
// — 덕분에 서버가 자고 있어도 혼자 플레이는 그대로 돌아간다.
renderState(appState.state);

// #ranking으로 들어오면 순위표부터 연다. 닉네임을 정하기 전에도 볼 수 있다 —
// 남이 보낸 링크를 받은 사람에게 이름부터 지으라고 할 이유가 없다.
if (location.hash.slice(1).toLowerCase() === "ranking") navTo("ranking");
