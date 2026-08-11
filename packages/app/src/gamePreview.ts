/* ============================================================
   gamePreview — 판 밖에서 도는 장식용 게임들
   ------------------------------------------------------------
   두 자리에 쓴다. 둘 다 **같은 규칙**을 따르므로 루프도 하나다.
     · 게임 목록의 작은 판(mountGamePreview)
     · 메뉴 뒤에서 흐르는 배경(mountBackgroundGame)

   그림 파일을 두지 않는 이유: **게임을 실제로 돌려서 그린다.** 게임마다 이미
   `factory()`와 `render(IRenderer)`가 있으므로, 캔버스에 같은 게임을 띄우면 그게 곧
   미리보기다. 게임을 추가하면 미리보기도 저절로 생기고, 게임 그림을 고치면 여기도
   같이 바뀐다 — 따로 관리할 에셋이 없다.
   (효과음을 합성으로 만든 것과 같은 결정이다 — 파일로 둘 이유가 없으면 안 둔다.)

   ⚠️ **판정이 아니라 장식이다.** 시드는 아무거나 쓰고, 조작이 없으니 곧 죽는다 —
      죽으면 새 시드로 되살아나 짧은 생을 반복한다. 결정론과 아무 관계가 없다.
   ⚠️ 보이는 동안만 돈다. 목록을 떠나거나 판이 시작되면 멈추고, 창이 뒤로 가도 멈춘다
      (소리와 같은 기준 — pageFocus). 「움직임 줄이기」를 켠 사람에게는 한 장만 그린다.
   ⚠️ 소리는 내지 않는다. `consumeSounds`를 아무도 안 가져가도 게임 안의 Set은 어휘
      수만큼만 커진다(JungnimGame 주석). 그래서 비워 줄 필요가 없다.
   ============================================================ */

import { Canvas2DRenderer } from "@arcade/core";
import type { IGame, InputState } from "@arcade/shared";
import { GAME_REGISTRY, type GameId } from "./GameRegistry";
import { isPageActive, watchPageFocus } from "./pageFocus";
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "./playLayout";

/** 자동 조작의 두 축이 도는 주기(tick). 서로 나누어떨어지지 않는 값이라 같은 모양이
 *  금방 반복되지 않는다 — 두 사인파의 마루가 겹치는 데 오래 걸린다. */
const WANDER_X_PERIOD = 37;
const WANDER_Y_PERIOD = 53;
/** 이 안쪽이면 그 축은 "안 누른 것"으로 본다. 0이면 네 방향 중 둘이 늘 눌려 있어
 *  대각선으로만 달린다 — 사람처럼 보이려면 멈칫하는 구간이 있어야 한다.
 *  ⚠️ 0.5는 눈대중이 아니라 **재서 고른 값이다.** 게임 셋을 시드 10개씩 돌려 평균 생존
 *     tick을 봤다(값이 클수록 리셋이 뜸하다 = 보기 좋다):
 *       데드존   0.0    0.3    0.5    0.7   0.85
 *       죽림고수  543    532    471    537    247
 *       커브      184    188    430    250    209
 *       무바닥    487    486    476    412    422
 *     커브가 특히 크게 갈린다 — 좌우가 곧 회전이라, 쉬는 구간이 없으면 제자리에서
 *     맴돌다 자기 자취에 박는다. 0.5에서 셋이 모두 14~16초(30fps)를 산다. */
const WANDER_DEADZONE = 0.5;

/** 붙이자마자 이만큼 미리 굴린 뒤 첫 그림을 그린다. 0tick의 판은 대개 텅 비어 있어
 *  ("아직 화살이 안 날아온" 상태) 화면이 빈 상자처럼 보인다. */
const WARMUP_TICKS = 150;

/** 도는 빠르기. 판은 60tick/초지만 장식에는 절반이면 충분하다 — 작은 그림에서
 *  30과 60의 차이는 안 보이고, 여러 개가 동시에 도는 값은 절반이 된다. */
const PREVIEW_FPS = 30;
const STEP_MS = 1000 / PREVIEW_FPS;

/** 한 프레임에 이 이상은 따라잡지 않는다. 탭이 한참 멈춰 있다 돌아오면 밀린 시간이
 *  통째로 들어오는데, 그걸 다 굴리면 화면이 한 번 얼어붙는다. 장식이라 건너뛰어도 된다. */
const MAX_STEPS = 3;

/** 배경으로는 안 쓰는 게임. 목록의 썸네일에서는 그대로 나온다 — 거기서는 **고르려는
 *  게임**을 보여줘야 하므로 뺄 수 없다.
 *  숫자 야구를 뺀 이유: 조작이 숫자 입력이라 자동 조작(방향)이 아무것도 못 한다.
 *  그래서 배경에 깔리면 거의 멈춘 그림이 된다 — 흐르는 배경으로는 볼 게 없다.
 *  ⚠️ 게임을 추가할 때 판단할 것: 방향 조작으로 화면이 움직이는 게임인가. */
const NOT_BACKGROUND: ReadonlySet<string> = new Set(["baseball"]);

/** 배경에 쓸 게임은 **들어올 때마다 새로 뽑는다.** 늘 같은 게임이면 두 번째 방문부터는
 *  배경이 아니라 벽지가 된다. 한 방문 동안에는 안 바뀐다 — 배경이 도중에 갈리면
 *  그게 눈에 걸려 앞의 글을 읽는 데 방해가 된다. */
function pickBackgroundGame(): GameId {
  const ids = (Object.keys(GAME_REGISTRY) as GameId[]).filter((id) => !NOT_BACKGROUND.has(id));
  return ids[Math.floor(Math.random() * ids.length)];
}

/** 배경 캔버스의 해상도 상한(한 변, CSS px 기준). 배경은 뷰포트를 덮을 만큼 커서
 *  DPR까지 곱하면 화면 하나를 통째로 다시 칠하는 꼴이 된다. 낮춰 잡고 CSS로 늘리면
 *  값도 싸지고 그림도 부드러워진다 — 어차피 흐릿하게 깔리는 배경이다. */
const BACKGROUND_MAX_SIDE = 640;

type View = {
  game: IGame;
  renderer: Canvas2DRenderer;
  canvas: HTMLCanvasElement;
  tick: number;
  seed: number;
  /** 표시 크기에 이 값을 곱해 해상도를 잡는다(배경만 1보다 작다). */
  maxSide: number;
  /** 자동 조작 사인파의 시작 위상. 판마다 달라야 넷이 **같은 춤을 추지 않는다.** */
  phase: number;
};

/** 미리보기를 조작하는 흉내. 게임을 아는 코드가 아니다 — 방향 넷을 천천히 바꿔 줄 뿐이고,
 *  그걸 어떻게 쓰는지는 게임마다 다르다(죽림고수는 8방향 이동, 커브는 좌우 회전,
 *  무너지는 바닥은 칸 이동, 숫자 야구는 방향을 아예 안 본다).
 *  ⚠️ 잘 하려는 게 아니다. 가만히 서 있으면 몇 초 만에 죽어 판이 계속 리셋되는데,
 *     움직이기만 해도 훨씬 오래 살고 무엇보다 **누가 하고 있는 것처럼** 보인다. */
function wanderInput(view: View): InputState {
  const x = Math.sin(view.tick / WANDER_X_PERIOD + view.phase);
  const y = Math.cos(view.tick / WANDER_Y_PERIOD + view.phase * 1.7);
  return {
    left: x < -WANDER_DEADZONE,
    right: x > WANDER_DEADZONE,
    up: y < -WANDER_DEADZONE,
    down: y > WANDER_DEADZONE,
  };
}

const thumbs: View[] = [];
let background: View | null = null;
let thumbsOn = false;
let backgroundOn = false;

let frame = 0;
let lastTime = 0;
let carry = 0;
let focusWatched = false;

/** 움직임을 줄여 달라는 사람에게는 **한 장만** 그린다. 무슨 게임인지는 그 한 장으로
 *  보이므로 정보는 잃지 않고 화면만 조용해진다. */
function wantsStill(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function createView(canvas: HTMLCanvasElement, id: GameId, maxSide: number): View {
  const game = GAME_REGISTRY[id].factory();
  const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
  game.init(seed);
  const view: View = {
    game,
    renderer: new Canvas2DRenderer(canvas, LOGICAL_WIDTH, LOGICAL_HEIGHT),
    canvas,
    tick: 0,
    seed,
    maxSide,
    phase: Math.random() * Math.PI * 2,
  };
  for (let i = 0; i < WARMUP_TICKS; i++) step(view);
  fit(view);
  draw(view);
  return view;
}

/** 목록을 다시 그릴 때 먼저 부른다. 남은 미리보기를 버린다 — 사라진 캔버스에 계속
 *  그리면 그 게임 인스턴스가 통째로 붙잡혀 있게 된다. */
export function clearGamePreviews(): void {
  thumbs.length = 0;
}

/** 목록의 작은 판. 목록을 만들면서 부른다. */
export function mountGamePreview(canvas: HTMLCanvasElement, id: GameId): void {
  thumbs.push(createView(canvas, id, Infinity));
}

/** 메뉴 뒤에 흐르는 배경 판. 부트스트랩에서 한 번 부른다 — 그래서 어느 게임이
 *  깔릴지는 **새로 들어올 때마다** 달라진다. */
export function mountBackgroundGame(canvas: HTMLCanvasElement): void {
  background = createView(canvas, pickBackgroundGame(), BACKGROUND_MAX_SIDE);
}

/** 목록 화면이 보이는 동안만 켠다(AppView.renderState가 부른다). */
export function setGamePreviewsRunning(on: boolean): void {
  thumbsOn = on;
  sync();
}

/** 판이 도는 동안에는 끈다 — 배경은 그때 CSS로도 걷힌다(body.playing #bg-decor). */
export function setBackgroundRunning(on: boolean): void {
  backgroundOn = on;
  sync();
}

/** 지금 돌아야 하는 판들. */
function activeViews(): View[] {
  const list: View[] = [];
  if (thumbsOn) list.push(...thumbs);
  if (backgroundOn && background) list.push(background);
  return list;
}

function sync(): void {
  if (!focusWatched) {
    // 창이 뒤로 가면 멈추고 돌아오면 다시 켠다 — 안 보이는 화면을 굴릴 이유가 없다.
    watchPageFocus(() => sync());
    focusWatched = true;
  }
  const should = isPageActive() && !wantsStill() && activeViews().length > 0;
  if (should && frame === 0) {
    lastTime = performance.now();
    carry = 0;
    frame = requestAnimationFrame(loop);
  } else if (!should && frame !== 0) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}

function loop(now: number): void {
  frame = requestAnimationFrame(loop);
  carry += now - lastTime;
  lastTime = now;
  const steps = Math.min(MAX_STEPS, Math.floor(carry / STEP_MS));
  if (steps <= 0) return;
  carry -= steps * STEP_MS;
  for (const view of activeViews()) {
    for (let i = 0; i < steps; i++) step(view);
    draw(view);
  }
}

/** 한 스텝. 죽었으면 그 자리에서 새 시드로 되살린다 — 사망 화면을 보여주지 않으려는
 *  것이다. 작은 그림에서는 "사망" 글자가 읽히지도 않고, 장식은 움직임만 보여주면 된다. */
function step(view: View): void {
  view.game.update(view.tick++, wanderInput(view));
  if (!view.game.isPlayerDead()) return;
  view.seed = (view.seed * 1664525 + 1013904223) >>> 0;
  view.game.init(view.seed);
  view.tick = 0;
}

function draw(view: View): void {
  view.game.render(view.renderer, 0);
}

/** 표시 크기(CSS px)를 읽어 해상도를 맞춘다. 안 보이는 캔버스는 건너뛴다 —
 *  크기가 0이면 백킹스토어를 잡을 수 없다(GameSession.fitRenderer와 같은 규칙). */
function fit(view: View): void {
  const rect = view.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  // 상한이 걸린 판(배경)은 표시 크기가 아니라 그 상한으로 해상도를 잡는다.
  const scale = Math.min(1, view.maxSide / Math.max(rect.width, rect.height));
  view.renderer.resize(rect.width * scale, rect.height * scale);
}

/** 창 크기·모니터(DPR)가 바뀌면 해상도를 다시 맞춘다. 돌고 있지 않으면 마지막 그림이
 *  남아 있으므로 한 장 다시 그려 준다. */
export function resizeGamePreviews(): void {
  for (const view of [...thumbs, ...(background ? [background] : [])]) {
    fit(view);
    draw(view);
  }
}
