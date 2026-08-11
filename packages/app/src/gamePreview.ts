/* ============================================================
   gamePreview — 게임 목록에 뜨는 작은 판
   ------------------------------------------------------------
   그림 파일을 두지 않는 이유: **게임을 실제로 돌려서 그린다.** 게임마다 이미
   `factory()`와 `render(IRenderer)`가 있으므로, 작은 캔버스에 같은 게임을 띄우면
   그게 곧 미리보기다. 게임을 추가하면 미리보기도 저절로 생기고, 게임 그림을
   고치면 목록도 같이 바뀐다 — 따로 관리할 에셋이 없다.
   (효과음을 합성으로 만든 것과 같은 결정이다 — 파일로 둘 이유가 없으면 안 둔다.)

   ⚠️ **판정이 아니라 장식이다.** 시드는 아무거나 쓰고, 조작이 없으니 곧 죽는다 —
      죽으면 새 시드로 다시 시작해 짧은 생을 반복한다. 결정론과 아무 관계가 없다.
   ⚠️ 목록 화면이 보일 때만 돈다. 게임 넷을 배경에서 계속 굴리면 정작 판에 쓸 힘을
      미리보기가 먹는다. 창이 뒤로 가도 멈춘다(소리와 같은 기준 — pageFocus).
   ⚠️ 소리는 내지 않는다. `consumeSounds`를 아무도 안 가져가면 게임 안에 쌓이지만,
      Set이라 어휘 수만큼만 커진다(JungnimGame 주석). 그래서 비워 줄 필요가 없다.
   ============================================================ */

import { Canvas2DRenderer } from "@arcade/core";
import type { IGame, InputState } from "@arcade/shared";
import { GAME_REGISTRY, type GameId } from "./GameRegistry";
import { isPageActive, watchPageFocus } from "./pageFocus";
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "./playLayout";

/** 아무것도 안 누른 상태. 미리보기에는 조작하는 사람이 없다. */
const IDLE: InputState = { up: false, down: false, left: false, right: false };

/** 붙이자마자 이만큼 미리 굴린 뒤 첫 그림을 그린다. 0tick의 판은 대개 텅 비어 있어
 *  ("아직 화살이 안 날아온" 상태) 목록이 빈 상자처럼 보인다. */
const WARMUP_TICKS = 150;

/** 미리보기가 도는 빠르기. 판은 60tick/초지만 여기서는 절반이면 충분하다 —
 *  90px짜리 그림에서 30과 60의 차이는 안 보이고, 넷이 동시에 도는 값은 절반이 된다. */
const PREVIEW_FPS = 30;
const STEP_MS = 1000 / PREVIEW_FPS;

/** 한 프레임에 이 이상은 따라잡지 않는다. 탭이 한참 멈춰 있다 돌아오면 밀린 시간이
 *  통째로 들어오는데, 그걸 다 굴리면 목록이 한 번 얼어붙는다. 장식이라 건너뛰어도 된다. */
const MAX_STEPS = 3;

type Preview = {
  game: IGame;
  renderer: Canvas2DRenderer;
  canvas: HTMLCanvasElement;
  tick: number;
  seed: number;
};

const previews: Preview[] = [];
let running = false;
let frame = 0;
let lastTime = 0;
let carry = 0;
let focusWatched = false;

/** 움직임을 줄여 달라는 사람에게는 **한 장만** 그린다. 목록이 정보를 잃지 않으면서
 *  (무슨 게임인지는 그 한 장으로 보인다) 화면이 조용해진다. */
function wantsStill(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 목록을 다시 그릴 때 먼저 부른다. 남은 미리보기를 버린다 — 사라진 캔버스에
 *  계속 그리면 그 게임 인스턴스가 통째로 붙잡혀 있게 된다. */
export function clearGamePreviews(): void {
  previews.length = 0;
}

/** 캔버스 하나에 그 게임의 미리보기를 붙인다. 목록을 만들면서 부른다. */
export function mountGamePreview(canvas: HTMLCanvasElement, id: GameId): void {
  const game = GAME_REGISTRY[id].factory();
  const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
  game.init(seed);
  const renderer = new Canvas2DRenderer(canvas, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  const preview: Preview = { game, renderer, canvas, tick: 0, seed };
  for (let i = 0; i < WARMUP_TICKS; i++) step(preview);
  previews.push(preview);
  fit(preview);
  draw(preview);
}

/** 목록 화면이 보이는 동안만 켠다(AppView.renderState가 부른다). */
export function setGamePreviewsRunning(on: boolean): void {
  if (!focusWatched) {
    // 창이 뒤로 가면 멈추고 돌아오면 다시 켠다 — 안 보이는 화면을 굴릴 이유가 없다.
    watchPageFocus(() => sync());
    focusWatched = true;
  }
  running = on;
  sync();
}

function sync(): void {
  const should = running && isPageActive() && previews.length > 0 && !wantsStill();
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
  for (const preview of previews) {
    for (let i = 0; i < steps; i++) step(preview);
    draw(preview);
  }
}

/** 한 스텝. 죽었으면 그 자리에서 새 시드로 되살린다 — 사망 화면을 보여주지 않으려는
 *  것이다. 90px에서는 "사망" 글자가 읽히지도 않고, 목록은 움직임만 보여주면 된다. */
function step(preview: Preview): void {
  preview.game.update(preview.tick++, IDLE);
  if (!preview.game.isPlayerDead()) return;
  preview.seed = (preview.seed * 1664525 + 1013904223) >>> 0;
  preview.game.init(preview.seed);
  preview.tick = 0;
}

function draw(preview: Preview): void {
  preview.game.render(preview.renderer, 0);
}

/** 표시 크기(CSS px)를 읽어 해상도를 맞춘다. 안 보이는 캔버스는 건너뛴다 —
 *  크기가 0이면 백킹스토어를 잡을 수 없다(GameSession.fitRenderer와 같은 규칙). */
function fit(preview: Preview): void {
  const rect = preview.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  preview.renderer.resize(rect.width, rect.height);
}

/** 창 크기·모니터(DPR)가 바뀌면 해상도를 다시 맞춘다. 돌고 있지 않으면 마지막
 *  그림이 남아 있으므로 한 장 다시 그려 준다. */
export function resizeGamePreviews(): void {
  for (const preview of previews) {
    fit(preview);
    draw(preview);
  }
}
