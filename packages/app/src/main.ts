/* ============================================================
   main — 앱의 배선판
   ------------------------------------------------------------
   여기 남는 것은 **잇는 일**이다: 화면 상태(FSM)와 세션·네트워크·버튼을 서로에게
   소개하고, 한 판의 흐름(카운트다운 → 시작 → 사망 → 관전 → 결과)을 순서대로 부른다.

   내용을 가진 것들은 각자 자기 파일에 산다:
   - hud.ts          기록·게이지 표시(단위와 경고 방향은 게임이 정한다)
   - peerReport.ts   0.1초마다 내 위치·기록을 남에게 알리는 루프
   - serverRoutes.ts 서버 메시지 하나 → 앱의 행동
   - navigation.ts   헤더 내비와 주소(해시)
   - soloPlay/rankingScreen 은 자기 상태(티켓·판 일련번호·보던 게임)를 들고 따로 산다

   ⚠️ 방과 라운드의 사실(내 신원·방장 여부·고른 게임·결과)은 **여기가 소유한다.**
      떼어 낸 파일들은 그것을 몰래 읽지 않고, 필요한 통로만 받아 간다 — 그래야
      "지금 무엇이 참인가"를 한 곳에서 읽을 수 있다.
   ============================================================ */

import { NetClient, StateMachine } from "@arcade/core";
import type { RankEntry } from "@arcade/shared";
import { APP_TRANSITIONS, type AppEvent, type AppState } from "./AppFlow";
import { shortcutFor } from "./shortcuts";
import { initAudio, play } from "./audio";
import { LOBBY_TRACK, initBgm, playBgm, silenceBgm } from "./bgm";
import { initBgDecor } from "./bgDecor";
import {
  renderGameList,
  renderLobby,
  renderResult,
  renderState,
  setAliveHud,
  setSideSlot,
  toast,
} from "./AppView";
import { cancelCountdown, runCountdown } from "./countdown";
import { byId } from "./dom";
import { initFullscreenShell } from "./fullscreen";
import { initInstallShell } from "./install";
import { initOptions, renderOptions } from "./optionsScreen";
import { initPageFocus } from "./pageFocus";
import { mountBackgroundGame, resizeGamePreviews } from "./gamePreview";
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, layoutPlayArea } from "./playLayout";
import { ROOM_CODE_PATTERN, createRoom, joinRoom } from "./roomConnect";
import { initSoundShell } from "./soundShell";
import {
  bulletFx,
  deathFx,
  fallScreen,
  resetScreenFx,
  slideInScreen,
  swapSpectateScreen,
} from "./screenFx";
import { GAME_REGISTRY, gameEntry, isGameId, type GameId } from "./GameRegistry";
import { GameSession } from "./GameSession";
import { updateHud } from "./hud";
import { startPeerReport } from "./peerReport";
import { bindNav, syncHash } from "./navigation";
import { createServerRouter } from "./serverRoutes";
import {
  loadLookSpeed,
  loadNickname,
  loadSideViews,
  saveLookSpeed,
  saveNickname,
  saveSideViews,
} from "./prefs";
import { createRankingScreen } from "./rankingScreen";
import { createSoloPlay } from "./soloPlay";

const mainCanvas = byId<HTMLCanvasElement>("game");
const sideCanvases = Array.from({ length: 3 }, (_, index) => byId<HTMLCanvasElement>(`side-${index}`));

const appState = new StateMachine<AppState, AppEvent>("nickname", APP_TRANSITIONS, ({ to }) => {
  renderState(to);
  syncHash(to, roomCode);
  syncBgm(to);
});

/** 판이 도는 동안 그 게임의 곡이 흐르는 상태들. 카운트다운부터다 — 판이 내려오는
 *  3초가 이미 그 게임의 시간이고, 시작 순간에 곡이 바뀌면 "시작!"과 겹친다.
 *  ⚠️ 관전과 deadResult도 여기 있다. 내가 죽어도 **남의 판은 계속 도는 중**이다 —
 *     끝나지도 않은 판에서 음악만 먼저 로비로 돌아가면 안 된다. */
const IN_PLAY: readonly AppState[] = ["countdown", "playing", "dying", "deadResult", "spectating"];

/** 지금 화면에 맞는 곡으로.
 *  ⚠️ **결과 화면은 무음이다.** 등수를 보는 자리라 음악이 깔리면 판이 아직 이어지는
 *     것처럼 들린다. 마침표(결과음)와 순위표만 남긴다. 곡은 버리지 않고 멈춰 두므로
 *     대기실로 돌아가면 있던 자리에서 이어진다. */
function syncBgm(state: AppState): void {
  if (state === "result") return silenceBgm();
  const track = IN_PLAY.includes(state) && selectedGameId ? gameEntry(selectedGameId).bgm : undefined;
  playBgm(track ?? LOBBY_TRACK);
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
  // 관전창이 생기거나 마지막 하나가 사라지면 **판이 쓸 가로가 달라진다** — 다시 잰다.
  onSideSlot: (index, visible, label) => {
    if (setSideSlot(index, visible, label)) relayout();
  },
  onHud: showHud,
  // 조작 영역이 생기거나 사라지면 판이 쓸 세로가 달라진다 — 판 크기를 다시 잡는다.
  onControlsChange: () => relayout(),
  // 서버로 조준 발사를 보내고, 내 화면에는 그 관전창으로 탄환이 날아가 명중하는 연출을 건다.
  onFire: (kind, durationMs, targetId, slotIndex) => {
    net.send({ type: "fire_effect", kind, durationMs, targetId });
    bulletFx(slotIndex, kind);
  },
});

/** HUD는 지금 고른 게임의 단위로 적힌다(기록이 초인지 점인지, 게이지 이름과 경고 방향).
 *  hud.ts가 그 규칙을 알고, 여기서는 "어느 게임인지"만 얹어 준다. */
function showHud(score: number, gauge: number | null): void {
  updateHud(selectedGameId, score, gauge);
}

/** 표시 크기를 먼저 정하고(레이아웃), 그 크기에 맞춰 캔버스 해상도를 잡는다(렌더러). 순서 중요. */
function relayout(): void {
  layoutPlayArea(LOGICAL_WIDTH / LOGICAL_HEIGHT);
  session.resizeViews();
  // 목록의 미리보기 판도 같은 이유로 해상도를 다시 잡는다(표시 크기가 clamp라 폭을 탄다).
  resizeGamePreviews();
}
// 메뉴 뒤에 흐르는 배경 판. relayout보다 먼저 붙여야 첫 해상도 계산에 함께 들어간다.
mountBackgroundGame(byId<HTMLCanvasElement>("bg-game"));
relayout();
// 창 크기·모니터(DPR) 변경 시 다시 맞춘다.
window.addEventListener("resize", relayout);
// 폰을 눕히면 resize보다 orientationchange가 먼저 오거나, iOS에서는 resize 시점의
// innerWidth가 아직 회전 전 값인 경우가 있다. 한 번 더 맞춰 두면 어느 쪽이든 맞는다.
window.addEventListener("orientationchange", () => setTimeout(relayout, 0));

/** 방에 연결된 상태인가. 서버 연결은 방에 들어갈 때 맺고 나올 때 끊는다
 *  — 앱 시작 시점에는 연결하지 않는다(혼자 플레이는 서버가 없어도 돌아간다). */
let inRoom = false;
/** 지금 들어가 있는 방의 코드. 주소에 남겨 두는 값이라 방을 나가면 비운다
 *  — 이게 붙어 있어야 주소를 그대로 보내 친구가 바로 들어올 수 있다. */
let roomCode: string | null = null;
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
  resetHud: () => showHud(0, null),
});

const ranking = createRankingScreen({
  isOpen: () => appState.state === "ranking",
  nickname: () => myNickname,
});

function startSolo(): void {
  if (!selectedGameId) return;
  // ⚠️ **여기가 포인터를 잠글 수 있는 유일한 자리다.** 잠금은 사용자 동작 안에서만
  //    허락되는데, 판이 실제로 시작되는 시점은 카운트다운 타이머라 동작이 아니다.
  //    이 클릭에서 미리 잠가 두면 판이 시작될 때 이미 겨눌 수 있다(추가 클릭 없음).
  session.prepareLook(selectedGameId);
  void solo.start(selectedGameId);
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
  net.send({ type: "player_died", score });
  transition("local_death"); // → dying (카드 없음, 낙하만 재생)
  // 낙하가 끝나면 자동으로 관전 전환. 선택 화면은 없다.
  clearTimeout(fallTimer);
  fallTimer = window.setTimeout(autoSpectate, FALL_MS);
}

/* 판 밖에서 듣는 키는 여기 한 곳으로 들어온다. **뜻은 shortcuts.ts가 정하고 여기서는
   그 뜻대로 하기만 한다** — 리스너가 늘 때마다 "지금 무슨 화면인가"를 되묻던 것을 없앴다. */
window.addEventListener("keydown", (event) => {
  const action = shortcutFor(event.key, {
    state: appState.state,
    solo: soloMode,
    repeat: event.repeat,
    buttonFocused: document.activeElement instanceof HTMLButtonElement,
  });
  if (!action) return;
  event.preventDefault();
  if (action.kind === "spectate") {
    // 넘길 남이 없으면 cycleSpectate가 거절한다 — 그때는 화면도 안 민다.
    if (session.cycleSpectate(action.direction)) swapSpectateScreen(action.direction);
    return;
  }
  byId(action.kind === "again" ? "again-btn" : "result-leave-btn").click();
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

/** 결과 화면이 떠 있고 보여 줄 결과가 있을 때만 다시 그린다. 방장이 바뀌거나 방 상태가
 *  다시 왔을 때 부른다 — "다시 하기"를 누를 수 있는 사람이 그 사이 바뀌었을 수 있다. */
function refreshResult(): void {
  if (appState.state !== "result" || finalRanks.length === 0) return;
  renderResult(finalRanks, myId, amHost, soloMode, selectedGameId);
}

/* 서버에서 오는 것은 전부 라우터를 거친다. 무엇에 기대는지는 여기 넘기는 목록이 전부다
   — main의 전역 변수를 라우터가 몰래 읽지 않는다(serverRoutes.ts 머리말). */
net.onMessage(
  createServerRouter({
    session,
    state: () => appState.state,
    transition,
    myId: () => myId,
    setMyId: (id) => {
      myId = id;
    },
    setHost: (isHost) => {
      amHost = isHost;
    },
    setGame: (id) => {
      selectedGameId = id;
    },
    setRoomCode: (code) => {
      roomCode = code;
      syncHash(appState.state, roomCode); // 방 상태가 전이 없이 다시 올 수도 있다.
    },
    refreshResult,
    startCountdown,
    showResult,
  }),
);

const RANDOM_NAMES = ["고수", "초심자", "바람", "그림자", "은둔자", "검객", "나그네"];
// 지난 방문에 쓴 닉네임을 입력칸에 미리 채운다(매번 다시 안 치게).
byId<HTMLInputElement>("nick-input").value = loadNickname();

/** 이름을 세우고 입구를 지난다. **버튼과 자동 입장이 같은 길을 쓴다** — 이름을 기억하고
 *  인사말을 채우고 전이하는 셋 중 하나만 빠져도 헤더의 「게임」이 이름 화면으로 되돌아간다
 *  (navigation의 `named`가 이 값을 본다). */
function enterAs(nickname: string): void {
  myNickname = nickname;
  saveNickname(myNickname); // 랜덤으로 정해진 이름도 기억해 다음에 이어 쓴다.
  byId("main-hello").textContent = `${myNickname} 님, 환영합니다`;
  transition("nickname_submit");
  tryAutoJoin();
}

byId("nick-go").addEventListener("click", () => {
  const value = byId<HTMLInputElement>("nick-input").value.trim();
  enterAs(value || `${RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]}${Math.floor(Math.random() * 100)}`);
});
// 이름을 다 치고 나면 손은 이미 Enter 위에 있다. 거기서 버튼까지 가는 건 헛걸음이다.
// ⚠️ 조합 중인 Enter는 제출이 아니라 **한글을 확정하는 키**다. 여기서 가로채면 마지막
//    글자가 확정되기 전에 화면이 넘어가 이름 끝 글자가 잘린다.
byId("nick-input").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  byId("nick-go").click();
});

byId("menu-start").addEventListener("click", () => {
  renderGameList(selectGame);
  transition("open_games");
});
byId("menu-options").addEventListener("click", () => {
  renderOptions(); // 헤더 🔊로 바뀐 값이 있을 수 있다 — 열 때마다 지금 상태를 그린다.
  transition("nav_options");
});
byId("menu-nickname").addEventListener("click", () => {
  const input = byId<HTMLInputElement>("nick-input");
  // 지금 이름을 담아 열고 골라 둔다 — 바꾸러 온 사람은 대개 처음부터 다시 치거나 한 글자만 고친다.
  input.value = myNickname;
  // 라벨을 바꾼다. 이미 들어와 있는 사람에게 "입장"은 어디로 들어가라는 말인지 모를 소리다.
  byId("nick-go").textContent = "바꾸기";
  transition("change_nickname");
  input.focus();
  input.select();
});
byId("options-back").addEventListener("click", () => nav.navTo("game"));
// 크레딧은 배선이 없다 — 저장소의 ASSET_CREDITS.md로 나가는 <a>라 브라우저가 알아서 한다.

const FIRST_GAME_ID = Object.keys(GAME_REGISTRY)[0] as GameId;

const nav = bindNav({
  transition,
  inRoom: () => inRoom,
  named: () => myNickname !== "",
  // 헤더로 열면 마지막에 보던 게임으로 돌아간다(없으면 고른 게임, 그것도 없으면 첫 게임).
  rankingGame: () => ranking.lastViewed() ?? selectedGameId ?? FIRST_GAME_ID,
  showRanking: (gameId) => ranking.show(gameId),
});
byId("lobby-rank-btn").addEventListener("click", () => nav.goRanking(selectedGameId ?? FIRST_GAME_ID));
byId("result-rank-btn").addEventListener("click", () => nav.goRanking(selectedGameId ?? FIRST_GAME_ID));
/* 푸터의 「개인정보 안내」는 배선이 없다 — data-nav="privacy"라 bindNav가 가져간다.
   ⚠️ 두 화면의 「뒤로」는 **헤더의 「게임」과 같은 길을 쓴다.** 고정으로 메인에 보내면
      이름을 아직 안 정한 사람(이 둘은 닉네임 화면에서도 열린다)이 빈 인사말이 뜬 메인에
      떨어진다. navTo가 이름 유무를 보고 갈라 준다. */
byId("privacy-back").addEventListener("click", () => nav.navTo("game"));
byId("gamelist-back").addEventListener("click", () => transition("back_main"));

function selectGame(id: GameId): void {
  selectedGameId = id;
  renderLobby(id);
  // 감도는 시선을 돌리는 게임에서만, 그리고 마우스가 달린 기기에서만 뜻이 있다.
  byId("lobby-sens").hidden = !session.usesLook(id) || !hasMouse();
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
  if (!ensureNetwork()) return;
  // 방장의 클릭도 사용자 동작이다 — 여기서 미리 잠근다(위 startSolo 주석 참조).
  // ⚠️ 다른 참가자에게는 이런 클릭이 없다. 그 사람들은 판 위 첫 클릭으로 잠근다.
  if (selectedGameId) session.prepareLook(selectedGameId);
  net.send({ type: "start_game" });
});
/* ---- 실시간 관전(곁창) 켜고 끄기 --------------------------------------------
   **각자의 설정이다.** 방장이 정하지 않고 서버도 모른다 — 곁창은 내 화면의 일이라,
   누가 켜고 누가 껐든 판정에 아무 영향이 없다.
   ⚠️ 끄면 곁창이 차지하던 폭이 판으로 간다(판이 커진다). 그 이득을 알고 고른 설정이다.
   ⚠️ **죽은 뒤 남의 화면으로 넘어가는 것은 이 설정과 무관하다.** 저건 곁창이 아니라
      내 판 자리에서 일어나는 일이라 끄든 켜든 그대로 넘어간다. */
let sideViewsOn = loadSideViews();

function renderSideViewsToggle(): void {
  const button = byId("sideviews-toggle");
  button.textContent = `실시간 관전 : ${sideViewsOn ? "켬" : "끔"}`;
  button.setAttribute("aria-pressed", String(sideViewsOn));
  byId("sideviews-hint").textContent = sideViewsOn
    ? "남들 화면이 오른쪽에 뜹니다."
    : "곁창이 없는 대신 판이 커집니다. 죽으면 남의 화면으로 넘어가는 건 그대로입니다.";
  session.setSideViews(sideViewsOn);
}

byId("sideviews-toggle").addEventListener("click", () => {
  sideViewsOn = !sideViewsOn;
  saveSideViews(sideViewsOn);
  renderSideViewsToggle();
});
renderSideViewsToggle();

/* ---- 마우스 감도 ---------------------------------------------------------
   **각자의 설정이다.** 곁창과 같은 이유로 방장이 정하지 않고 서버도 모른다 — 조준은 내
   화면의 일이고, 공통 월드는 시드가 정한 대로 남과 똑같이 흐른다.
   ⚠️ 대기실이 아니라 로비에 둔다. 혼자 플레이에는 대기실이 없어서, 거기 두면 정작 감도를
      맞춰 보고 싶은 연습 판에서 손댈 곳이 없어진다. */

/** 마우스가 달린 기기인가. 폰에 이 손잡이를 띄우면 아무 일도 안 하는 것을 보여 주는 꼴이다. */
function hasMouse(): boolean {
  return typeof matchMedia !== "function" || matchMedia("(any-pointer: fine)").matches;
}

let lookSpeed = loadLookSpeed();

function renderLookSpeed(): void {
  byId<HTMLInputElement>("lobby-sens-range").value = String(Math.round(lookSpeed * 100));
  byId("lobby-sens-out").textContent = `${lookSpeed.toFixed(1)}×`;
  session.setLookSpeed(lookSpeed);
}

byId<HTMLInputElement>("lobby-sens-range").addEventListener("input", (event) => {
  lookSpeed = Number((event.target as HTMLInputElement).value) / 100;
  saveLookSpeed(lookSpeed);
  renderLookSpeed();
});
renderLookSpeed();

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
  roomCode = null; // 주소에서 방 코드를 뗀다(아래 전이도 같은 값으로 다시 맞춘다).
  syncHash(appState.state, roomCode);
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
  showHud(0, null); // 지난 판 숫자가 첫 프레임에 잠깐 비치지 않게.
  setAliveHud("생존 …");
  if (!session.start(gameId, seed, net.serverTimeToPerformance(startTime))) {
    toast(`게임을 시작할 수 없습니다: ${gameId}`);
  }
}

// 연습에는 내 위치를 볼 남이 없고, 관전 중에 보내면 죽은 사람이 살아 있는 것처럼 보인다.
startPeerReport(net, session, () => !soloMode && appState.state === "playing");

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
// 소리보다 먼저 — 이 창이 앞에 있는지가 소리를 낼지 말지의 조건이다.
initPageFocus();
initAudio(); // 저장된 효과음 설정을 읽는다. AudioContext는 첫 클릭 때 만들어진다.
initBgm(); // 음악 설정도 같은 자리에서(스위치는 각자 자기 모듈이 갖는다).
initOptions(); // 옵션 화면의 스위치에 동작을 건다.
// 음악도 같은 사정이다 — 지금은 자동재생이 막혀 있을 테니, bgm이 첫 조작을 기다렸다 튼다.
playBgm(LOBBY_TRACK);
// 소리 토글 버튼 + 클릭음 위임(앱 상태와 무관한 껍데기).
// 이 버튼은 옵션 화면 위에서도 눌리므로, 눌리면 저쪽 스위치 표시도 같이 고친다.
initSoundShell(renderOptions);
// 전체화면 버튼. 지원하지 않는 브라우저(아이폰 사파리)에서는 스스로 감춘다.
// 거절당하는 경우도 있다(인앱 웹뷰) — 그때는 왜 안 되는지 한 줄로 알린다.
initFullscreenShell(() => toast("이 브라우저에서는 전체화면을 쓸 수 없습니다. 홈 화면에 추가하면 같은 효과가 납니다."));
// 홈 화면 추가 버튼. 크롬이 스스로 띄우던 배너를 막고 그 기회를 이 버튼으로 옮긴다.
initInstallShell();

// 시작 시점에는 서버에 연결하지 않는다. 연결은 방에 들어갈 때 맺는다
// — 덕분에 서버가 자고 있어도 혼자 플레이는 그대로 돌아간다.
renderState(appState.state);

/* 지난번에 쓴 이름이 있으면 입구를 건너뛴다. 이름은 이미 정해져 있는데 방문할 때마다
   같은 화면에서 「입장」을 한 번씩 더 누르고 있었다 — 물어볼 것이 없으면 묻지 않는다.
   되돌아갈 길은 메인의 「이름 바꾸기」가 맡는다(그게 생기기 전이라면 못 할 짓이었다).
   ⚠️ 첫 그림보다 먼저 서야 한다. 늦으면 이름 화면이 한 번 떴다가 사라진다.
   ⚠️ 방 코드 해시(`#ABCD`)는 이 전이가 주소에서 지운다(hashFor). 지워져도 되는 이유는
      코드를 이 파일 맨 위에서 이미 읽어 뒀기 때문이고, 그래서 enterAs가 자동 입장까지
      이어서 한다 — 링크를 받은 사람은 이름 화면도 목록도 안 거치고 방에 들어간다. */
// ⚠️ 주소부터 읽어 둔다. 아래 전이가 해시를 지우고 나서 읽으면 순위표 링크가 사라진다.
const wantRanking = location.hash.slice(1).toLowerCase() === "ranking";
const savedNickname = loadNickname();
if (savedNickname) enterAs(savedNickname);

// #ranking으로 들어오면 순위표부터 연다. 닉네임을 정하기 전에도 볼 수 있다 —
// 남이 보낸 링크를 받은 사람에게 이름부터 지으라고 할 이유가 없다.
if (wantRanking) nav.navTo("ranking");
