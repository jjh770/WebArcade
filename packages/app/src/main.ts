/* ============================================================
   앱 진입점 — 멀티플레이 플로우 컨트롤러
   ------------------------------------------------------------
   닉네임 → 로비(방 만들기/코드 입장) → 대기실 → 카운트다운 →
   플레이(서버가 준 시드로 GameRunner) → 순위표 → 다시하기/나가기.

   화면 전환은 DOM 오버레이, 게임은 캔버스. 네트워크는 NetClient.
   서버는 게임을 모른다 — 여기서도 seed·순위 같은 계약 메시지만 오간다.

   아직 아님(다음 슬라이스): 메뉴/옵션, 게임 선택 화면, 관전(남 화면).
   ============================================================ */

import { Canvas2DRenderer, GameRunner, InputManager, NetClient } from "@arcade/core";
import type { ServerMessage, PlayerPublic, RankEntry } from "@arcade/shared";
import { GAME_REGISTRY } from "./GameRegistry";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const WS_URL = `ws://${location.hostname || "localhost"}:8080`;
const GAME_ID = "jungnim"; // 이 슬라이스는 죽림고수 고정. 게임 선택 화면은 이후.

// ---- DOM 헬퍼 ----
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소를 찾을 수 없습니다.`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>("game");
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

const SCREENS = ["nickname", "lobby", "ready", "countdown", "result"] as const;
type ScreenName = (typeof SCREENS)[number];

/** 화면 전환. null이면 오버레이 전부 숨김 = 플레이(캔버스만). */
function show(name: ScreenName | null): void {
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle("active", s === name);
}

let toastTimer = 0;
function toast(msg: string): void {
  const t = $("error-toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3000);
}

// ---- 게임 + 러너 ----
const renderer = new Canvas2DRenderer(canvas);
const input = new InputManager();
const game = GAME_REGISTRY[GAME_ID].factory();
let runnerStarted = false;

const runner = new GameRunner(game, renderer, input, () => {
  // 로컬 사망 → 서버에 생존시간 보고(판 종료·순위는 서버가 판단).
  net.send({ type: "player_died", survivalTicks: game.getScore() });
});

// ---- 네트워크 상태 ----
const net = new NetClient();
let myId: string | null = null;
let myNickname = "";
let amHost = false;

net.onMessage(handleServer);

function handleServer(msg: ServerMessage): void {
  switch (msg.type) {
    case "welcome":
      myId = msg.id;
      break;
    case "room_state":
      amHost = msg.hostId === myId;
      renderReady(msg.code, msg.players, msg.hostId);
      // 플레이/카운트다운 중이 아니면 대기실을 보여준다.
      if (!$("screen-countdown").classList.contains("active") && !inPlay) show("ready");
      break;
    case "game_start":
      startCountdown(msg.seed, msg.startTime);
      break;
    case "ranking_update":
      // (생존자 수 등 실시간 표시는 관전 슬라이스에서. 지금은 game_over만 사용.)
      break;
    case "game_over":
      showResult(msg.finalRanks);
      break;
    case "host_changed":
      amHost = msg.newHostId === myId;
      break;
    case "error":
      toast(msg.reason);
      break;
  }
}

// ---- 닉네임 화면 ----
const RANDOM_NAMES = ["고수", "초심자", "바람", "그림자", "은둔자", "검객", "나그네"];
$("nick-go").addEventListener("click", () => {
  const v = $<HTMLInputElement>("nick-input").value.trim();
  myNickname = v || `${RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]}${Math.floor(Math.random() * 100)}`;
  $("lobby-hello").textContent = `${myNickname} 님, 환영합니다`;
  show("lobby");
});

// ---- 로비 화면 ----
$("create-btn").addEventListener("click", () => {
  net.send({ type: "create_room", gameId: GAME_ID, nickname: myNickname });
});
$("join-btn").addEventListener("click", () => {
  const code = $<HTMLInputElement>("join-code").value.trim().toUpperCase();
  if (code.length !== 4) return toast("코드 4자리를 입력하세요.");
  net.send({ type: "join_room", code, nickname: myNickname });
});

// ---- 대기실 화면 ----
function renderReady(code: string, players: readonly PlayerPublic[], hostId: string): void {
  $("ready-code").textContent = code;
  const ul = $("ready-players");
  ul.innerHTML = "";
  for (const p of players) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = p.nickname;
    li.appendChild(name);
    if (p.id === hostId) li.appendChild(badge("방장", ""));
    if (p.id === myId) li.appendChild(badge("나", "you"));
    ul.appendChild(li);
  }
  $<HTMLButtonElement>("start-btn").style.display = amHost ? "" : "none";
  $("ready-hint").textContent = amHost ? "인원이 모이면 시작을 누르세요." : "방장이 시작하기를 기다리는 중…";
}

function badge(text: string, cls: string): HTMLElement {
  const b = document.createElement("span");
  b.className = `badge ${cls}`.trim();
  b.textContent = text;
  return b;
}

$("start-btn").addEventListener("click", () => net.send({ type: "start_game" }));
$("leave-btn").addEventListener("click", () => {
  net.send({ type: "leave_room" });
  show("lobby");
});

// ---- 카운트다운 → 플레이 ----
let inPlay = false;
let countdownTimer = 0;

function startCountdown(seed: number, startTime: number): void {
  show("countdown");
  const tick = (): void => {
    const remain = startTime - Date.now();
    if (remain <= 0) {
      clearInterval(countdownTimer);
      beginPlay(seed);
      return;
    }
    $("countdown-num").textContent = String(Math.ceil(remain / 1000));
  };
  clearInterval(countdownTimer);
  countdownTimer = window.setInterval(tick, 100);
  tick();
}

function beginPlay(seed: number): void {
  show(null); // 오버레이 숨김 → 캔버스만.
  inPlay = true;
  // 첫 판은 start(입력·루프 부착), 이후 판은 restart(루프 유지, tick만 0).
  if (!runnerStarted) {
    runner.start(seed);
    runnerStarted = true;
  } else {
    runner.restart(seed);
  }
}

// ---- 결과 화면 ----
function showResult(finalRanks: readonly RankEntry[]): void {
  inPlay = false;
  const body = $("result-body");
  body.innerHTML = "";
  let myRank: number | null = null;
  for (const r of finalRanks) {
    const tr = document.createElement("tr");
    if (r.nickname === myNickname) myRank = r.rank; // (동명이인 가능 — 표시용 근사)
    tr.innerHTML =
      `<td class="rank">${r.rank}</td>` +
      `<td>${escapeHtml(r.nickname)}</td>` +
      `<td class="time">${(r.survivalTicks / 60).toFixed(1)}s</td>`;
    body.appendChild(tr);
  }
  $("result-sub").textContent = myRank ? `내 순위 ${myRank}위` : "";
  $<HTMLButtonElement>("again-btn").style.display = amHost ? "" : "none";
  $("result-hint").textContent = amHost ? "다시 하면 새 시드로 시작합니다." : "방장이 다시 시작하기를 기다리는 중…";
  show("result");
}

$("again-btn").addEventListener("click", () => net.send({ type: "start_game" }));
$("result-leave-btn").addEventListener("click", () => {
  net.send({ type: "leave_room" });
  show("lobby");
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// ---- 부팅: 서버 연결 ----
net.connect(WS_URL).catch(() => {
  toast("서버에 연결할 수 없습니다. 'npm run dev:server'가 켜져 있는지 확인하세요.");
});
