/* ============================================================
   앱 진입점 — 진입 구조 + 멀티플레이 플로우 + 1+3 멀티뷰
   ------------------------------------------------------------
   닉네임 → 메인 메뉴 → 게임 목록(GameRegistry 자동) → 로비 →
   대기실 → 카운트다운 → 플레이 → 순위표.

   플레이 화면(DESIGN 4.6): 메인 화면 크게 + 우측에 생존자 최대 3명.
   - 살아있으면 메인=내 화면, 죽으면 메인=관전 대상(생존자 1명).
   - 사이드=다른 생존자들(최대 3, 메인 대상 제외). 1+3→1+2→1+1 축소.
   - 공통 월드(화살)는 모두 동일하니, 뷰마다 "얹는 점"만 다르다.
     (상대 개인화살 재구성·무작위 교체 정교화는 이후.)

   게임 인스턴스/러너는 game_start.gameId(그 방의 게임)로 만든다.
   ============================================================ */

import { Canvas2DRenderer, GameRunner, InputManager, NetClient, type GameView } from "@arcade/core";
import type { IGame, ServerMessage, PlayerPublic, RankEntry } from "@arcade/shared";
import { GAME_REGISTRY, type GameId } from "./GameRegistry";
import { NOTICES } from "./siteContent";

const CANVAS_WIDTH = 800; // 내부 해상도(게임 좌표계). 표시 크기는 CSS.
const CANVAS_HEIGHT = 600;
const WS_URL = `ws://${location.hostname || "localhost"}:8080`;
const POSITION_SEND_MS = 100; // 관전용 위치 송신 주기(~10Hz).
const SIDE_SLOTS = 3; // 우측 생존자 최대 인원.

// ---- DOM 헬퍼 ----
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소를 찾을 수 없습니다.`);
  return el as T;
};

// 메인 캔버스 + 사이드 캔버스들: 전부 내부 해상도 800x600.
const mainCanvas = $<HTMLCanvasElement>("game");
mainCanvas.width = CANVAS_WIDTH;
mainCanvas.height = CANVAS_HEIGHT;
const mainRenderer = new Canvas2DRenderer(mainCanvas);

const sideRenderers: Canvas2DRenderer[] = [];
for (let i = 0; i < SIDE_SLOTS; i++) {
  const c = $<HTMLCanvasElement>(`side-${i}`);
  c.width = CANVAS_WIDTH;
  c.height = CANVAS_HEIGHT;
  sideRenderers.push(new Canvas2DRenderer(c));
}

const aliveHud = $("alive-hud");

const SCREENS = [
  "nickname", "main", "gamelist", "lobby", "ready", "countdown", "result",
  "notice", "about", "community",
] as const;
type ScreenName = (typeof SCREENS)[number];
const CONTENT_SCREENS = ["notice", "about", "community"] as const;

/** 화면 전환. null이면 오버레이 전부 숨김 + 플레이 영역 표시(헤더/푸터 숨김). */
function show(name: ScreenName | null): void {
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle("active", s === name);
  const playing = name === null;
  $("play").classList.toggle("on", playing);
  document.body.classList.toggle("playing", playing);
  // 헤더 내비 하이라이트: 콘텐츠 페이지면 그 항목, 아니면 '게임'.
  const navKey = name && (CONTENT_SCREENS as readonly string[]).includes(name) ? name : "game";
  document.querySelectorAll<HTMLElement>("#site-header .site-nav button").forEach((b) => {
    b.classList.toggle("on", b.dataset.nav === navKey);
  });
}

let toastTimer = 0;
function toast(msg: string): void {
  const t = $("error-toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3000);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// ---- 게임 구동 (선택된 게임으로 생성) ----
const input = new InputManager();
let game: IGame | null = null;
let runner: GameRunner | null = null;
let runnerStarted = false;
let activeGameId: GameId | null = null;
let selectedGameId: GameId | null = null;

/** game_start의 gameId(그 방의 게임)에 맞는 러너를 준비한다. 이미 맞으면 재사용. */
function ensureRunner(gameId: string): boolean {
  if (!(gameId in GAME_REGISTRY)) {
    toast(`알 수 없는 게임입니다: ${gameId}`);
    return false;
  }
  const id = gameId as GameId;
  if (activeGameId !== id) {
    runner?.stop();
    game = GAME_REGISTRY[id].factory();
    runner = new GameRunner(game, input, onLocalDeath);
    runnerStarted = false;
    activeGameId = id;
  }
  return true;
}

function onLocalDeath(): void {
  if (!game) return;
  net.send({ type: "player_died", survivalTicks: game.getScore() });
  myDead = true;
  pickMainSpectate();
  rebuildViews();
}

// ---- 네트워크 · 관전 상태 ----
const net = new NetClient();
let myId: string | null = null;
let myNickname = "";
let amHost = false;

type Peer = { nickname: string; alive: boolean; x: number; y: number };
const peers = new Map<string, Peer>();
let lastPlayers: readonly PlayerPublic[] = [];
let inPlay = false;
let myDead = false;
let spectateId: string | null = null; // 죽었을 때 메인 뷰의 관전 대상.
let sideShown: string[] = []; // 사이드에 표시 중인 생존자 id(슬롯 순서).

net.onMessage(handleServer);

function handleServer(msg: ServerMessage): void {
  switch (msg.type) {
    case "welcome":
      myId = msg.id;
      break;
    case "room_state":
      amHost = msg.hostId === myId;
      lastPlayers = msg.players;
      renderReady(msg.code, msg.players, msg.hostId);
      if (!$("screen-countdown").classList.contains("active") && !inPlay) show("ready");
      break;
    case "game_start":
      startCountdown(msg.seed, msg.startTime, msg.gameId);
      break;
    case "peer_state": {
      const p = peers.get(msg.id);
      if (!p) break;
      p.x = msg.px;
      p.y = msg.py;
      if (inPlay) {
        syncGamePeers(); // 게임에 위치 전달(개인 화살 재구성용)
        rebuildViews(); // 사이드/메인 관전 대상 위치 갱신.
      }
      break;
    }
    case "peer_died": {
      const p = peers.get(msg.id);
      if (p) p.alive = false;
      if (msg.id === spectateId) pickMainSpectate(); // 관전 대상 죽음 → 교체.
      if (inPlay) {
        syncGamePeers();
        rebuildViews();
      }
      break;
    }
    case "ranking_update":
      aliveHud.textContent = `생존 ${msg.alive} / ${msg.ranks.length}`;
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

// ---- 닉네임 → 메인 ----
const RANDOM_NAMES = ["고수", "초심자", "바람", "그림자", "은둔자", "검객", "나그네"];
$("nick-go").addEventListener("click", () => {
  const v = $<HTMLInputElement>("nick-input").value.trim();
  myNickname = v || `${RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]}${Math.floor(Math.random() * 100)}`;
  $("main-hello").textContent = `${myNickname} 님, 환영합니다`;
  show("main");
});

// ---- 메인 메뉴 ----
$("menu-start").addEventListener("click", () => {
  renderGameList();
  show("gamelist");
});
$("menu-options").addEventListener("click", () => toast("옵션은 준비 중입니다."));
$("menu-credits").addEventListener("click", () => toast("Arcade — 결정론 동기화 웹 멀티 아케이드 프레임워크"));

// ---- 사이트 헤더/푸터 내비 (공지/소개/커뮤니티) ----
function navTo(target: string | undefined): void {
  if (target === "game") {
    show(myNickname ? "main" : "nickname"); // 게임으로: 닉네임 정했으면 메뉴로.
    return;
  }
  if (target === "notice") renderNotices();
  if (target === "notice" || target === "about" || target === "community") show(target);
}
document.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    navTo(el.dataset.nav);
  });
});
$("footer-legal").addEventListener("click", () => toast("이용약관·개인정보는 준비 중입니다."));

function renderNotices(): void {
  const wrap = $("notice-list");
  wrap.innerHTML = "";
  for (const n of NOTICES) {
    const div = document.createElement("div");
    div.className = "notice-item";
    div.innerHTML =
      `<div class="notice-date">${escapeHtml(n.date)}</div>` +
      `<div class="notice-title">${escapeHtml(n.title)}</div>` +
      `<div class="notice-body">${escapeHtml(n.body)}</div>`;
    wrap.appendChild(div);
  }
}

// ---- 게임 목록 (GameRegistry에서 자동 생성) ----
function renderGameList(): void {
  const wrap = $("game-cards");
  wrap.innerHTML = "";
  for (const id of Object.keys(GAME_REGISTRY) as GameId[]) {
    const g = GAME_REGISTRY[id];
    const btn = document.createElement("button");
    btn.className = "game-card";
    btn.innerHTML = `<div class="g-title">${escapeHtml(g.title)}</div><div class="g-desc">${escapeHtml(g.description)}</div>`;
    btn.addEventListener("click", () => selectGame(id));
    wrap.appendChild(btn);
  }
}
$("gamelist-back").addEventListener("click", () => show("main"));

function selectGame(id: GameId): void {
  selectedGameId = id;
  $("lobby-title").textContent = GAME_REGISTRY[id].title;
  $("lobby-hello").textContent = GAME_REGISTRY[id].description;
  show("lobby");
}

// ---- 로비 ----
$("create-btn").addEventListener("click", () => {
  if (!selectedGameId) return;
  net.send({ type: "create_room", gameId: selectedGameId, nickname: myNickname });
});
$("join-btn").addEventListener("click", () => {
  const code = $<HTMLInputElement>("join-code").value.trim().toUpperCase();
  if (code.length !== 4) return toast("코드 4자리를 입력하세요.");
  net.send({ type: "join_room", code, nickname: myNickname });
});
$("lobby-back").addEventListener("click", () => show("gamelist"));

// ---- 대기실 ----
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
let countdownTimer = 0;

function startCountdown(seed: number, startTime: number, gameId: string): void {
  if (!ensureRunner(gameId)) return;
  show("countdown");
  let lastNum = -1;
  const tick = (): void => {
    const remain = startTime - Date.now();
    if (remain <= 0) {
      clearInterval(countdownTimer);
      beginPlay(seed);
      return;
    }
    const n = Math.ceil(remain / 1000);
    if (n !== lastNum) {
      lastNum = n;
      const el = $("countdown-num");
      el.textContent = String(n);
      // 매 초 숫자가 바뀔 때 팝(확대 → 원래대로).
      el.animate(
        [{ transform: "scale(1.5)", opacity: 0.35 }, { transform: "scale(1)", opacity: 1 }],
        { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
    }
  };
  clearInterval(countdownTimer);
  countdownTimer = window.setInterval(tick, 100);
  tick();
}

function beginPlay(seed: number): void {
  if (!runner) return;
  show(null); // 오버레이 숨김 → 플레이 영역.
  inPlay = true;
  myDead = false;
  spectateId = null;
  sideShown = [];
  aliveHud.textContent = "생존 …";
  aliveHud.hidden = false;
  // 먼저 게임을 init(start/restart) → 그다음 peer 아바타 동기화 + 뷰 구성.
  if (!runnerStarted) {
    runner.start(seed);
    runnerStarted = true;
  } else {
    runner.restart(seed);
  }
  buildPeers();
  syncGamePeers();
  rebuildViews();
}

/** 살아있는 남들의 위치를 게임에 알린다 → 게임이 각자 개인 화살을 재구성. */
function syncGamePeers(): void {
  if (!game) return;
  const list: { id: string; x: number; y: number }[] = [];
  for (const [id, p] of peers) if (p.alive) list.push({ id, x: p.x, y: p.y });
  game.syncPeers(list);
}

// ---- 관전 · 멀티뷰 ----
function buildPeers(): void {
  peers.clear();
  for (const p of lastPlayers) {
    if (p.id === myId) continue;
    peers.set(p.id, { nickname: p.nickname, alive: true, x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 });
  }
}

/** 죽었을 때 메인 뷰로 볼 생존자 1명 선택(없으면 null → 내 화면). */
function pickMainSpectate(): void {
  spectateId = null;
  for (const [id, p] of peers) {
    if (p.alive) {
      spectateId = id;
      break;
    }
  }
}

/** 메인 + 사이드 뷰 구성. 1+3→1+2→1+1 축소는 생존자 수에 따라 자동. */
function rebuildViews(): void {
  if (!runner) return;

  // 메인: 살아있으면 내 화면(null), 죽었으면 관전 대상.
  let mainTarget = null as GameView["target"];
  if (myDead && spectateId) {
    const p = peers.get(spectateId);
    if (p && p.alive) mainTarget = { id: spectateId, x: p.x, y: p.y, label: p.nickname };
  }
  const views: GameView[] = [{ renderer: mainRenderer, target: mainTarget }];

  // 사이드: 살아있는 남 최대 3명(메인 관전 대상 제외). 기존 표시 유지 후 빈 자리 채움.
  const excludeMain = myDead ? spectateId : null;
  const aliveOthers: string[] = [];
  for (const [id, p] of peers) if (p.alive && id !== excludeMain) aliveOthers.push(id);
  sideShown = sideShown.filter((id) => aliveOthers.includes(id));
  for (const id of aliveOthers) {
    if (sideShown.length >= SIDE_SLOTS) break;
    if (!sideShown.includes(id)) sideShown.push(id);
  }

  sideShown.forEach((id, i) => {
    const p = peers.get(id);
    if (p) views.push({ renderer: sideRenderers[i], target: { id, x: p.x, y: p.y, label: p.nickname } });
  });

  // 슬롯 표시/라벨 갱신(있는 만큼만 보인다 = 축소 규칙).
  for (let i = 0; i < SIDE_SLOTS; i++) {
    const on = i < sideShown.length;
    $(`slot-${i}`).classList.toggle("on", on);
    if (on) $(`label-${i}`).textContent = peers.get(sideShown[i])?.nickname ?? "";
  }

  runner.setViews(views);
}

// 관전용 위치 송신 — 플레이 중 살아있을 때만.
window.setInterval(() => {
  if (inPlay && !myDead && game) {
    const pos = game.getPosition();
    net.send({ type: "player_state", px: pos.x, py: pos.y });
  }
}, POSITION_SEND_MS);

// ---- 결과 화면 ----
function showResult(finalRanks: readonly RankEntry[]): void {
  inPlay = false;
  spectateId = null;
  sideShown = [];
  runner?.setViews([]);
  aliveHud.hidden = true;
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

// ---- 부팅 ----
show("nickname"); // 초기 상태(헤더 하이라이트·body 클래스) 일관성 확보.
net.connect(WS_URL).catch(() => {
  toast("서버에 연결할 수 없습니다. 'npm run dev:server'가 켜져 있는지 확인하세요.");
});
