/* ============================================================
   draw — 죽림고수의 색과 그림 (판정 아님)
   ------------------------------------------------------------
   여기 있는 것은 **한 판의 상태를 안 읽는 그리기**뿐이다. 넘겨받은 것만 그린다.
   그래서 이 파일이 무엇을 잘못해도 누가 죽는지는 안 바뀐다 — 화면만 이상해진다.
   반대로 arrowField는 판정이다. 둘을 섞지 않는 이유가 그것이다.

   경계선: 상태를 열 개씩 읽는 그리기(render·renderSpectator·drawActiveEffects·
   drawPickupSparks)는 클래스에 남겼다. 인자로 끌어내면 인자 목록이 곧 그 상태의
   사본이 되어, 옮긴 만큼도 안 줄어든다.

   색이 전부 여기 모인 이유: 팔레트가 한 화면에 보여야 "공통은 남색, 개인은 주황,
   아이템은 금색"이 서로 안 부딪히는지 눈으로 확인된다. 흩어 두면 하나 고칠 때
   나머지를 못 본다.
   ⚠️ 종류별 색·이름은 여기가 아니라 config.item.kinds가 원본이다(kindColor/kindLabel).
   ============================================================ */

import type { IRenderer } from "@arcade/shared";
import { jungnimConfig } from "./config";
import type { Arrow, ArrowPool } from "./ArrowPool";
import type { Item } from "./ItemSpawner";

export const PLAYER_COLOR = "#e63946";
export const ARROW_COLOR = "#1d3557"; // 공통(시드) 화살 — 짙은 남색.
export const PERSONAL_COLOR = "#f77f00"; // 개인(조준) 화살 — 주황. "너를 노린다"는 신호.
export const HUD_COLOR = "#e8eef2"; // HUD 텍스트 — 원 밖 어두운 영역 위라 밝게.
export const ITEM_COLOR = "#ffd166"; // 아이템 기본색(모르는 종류). 종류별 색은 config.item.kinds.
export const INVERT_COLOR = "#c77dff"; // 조작 반전 피격 중.
export const SLUGGISH_COLOR = "#4dd0e1"; // 조작 둔화 피격 중.

// 원형 경기장 색: 어두운 바깥 + 얇은 테두리 + 밝은 바닥.
const ARENA_OUTSIDE = "#15171d";
const ARENA_BORDER = "#457b9d";
const ARENA_FLOOR = "#f1faee";
const ARENA_BORDER_W = 3;

/** 아이템이 커졌다 작아지는 맥동 주기(tick)와 진폭(배율). 순수 렌더. */
const ITEM_PULSE_TICKS = 40;
const ITEM_PULSE_AMOUNT = 0.18;
/** 사라지기 직전 이 tick 동안 깜빡여 "곧 없어진다"를 알린다. */
const ITEM_FADE_TICKS = 120;
/** 등장 순간 이 tick 동안 부풀어 오른다 — 탄막 속에서 "새로 생겼다"가 보이게. */
const ITEM_POP_TICKS = 15;
/** 정화 파동 고리를 이루는 점 개수(반경이 커서 성기면 고리로 안 보인다). */
const PURGE_RING_DOTS = 28;

/** 정화 파동을 그리는 데 필요한 것 전부. 아바타는 이보다 많은 걸 들고 있지만
 *  그리기는 이 셋만 보므로, 여기서 아바타를 알 필요가 없다. */
export type PurgeSource = { purgeFlash: number; purgeX: number; purgeY: number };

/** 아이템 종류의 표시색·이름. 모르는 종류면 기본값(종류가 늘어도 옛 판정이 안 죽는다). */
export function kindColor(kind: string): string {
  return jungnimConfig.item.kinds.find((entry) => entry.kind === kind)?.color ?? ITEM_COLOR;
}

export function kindLabel(kind: string): string {
  return jungnimConfig.item.kinds.find((entry) => entry.kind === kind)?.label ?? "아이템";
}

/** 원형 경기장: 어두운 배경을 깔고, 그 위에 테두리 원 → 밝은 바닥 원을 겹쳐 링을 만든다. */
export function drawArena(r: IRenderer): void {
  const { cx, cy, radius } = jungnimConfig.arena;
  r.clear();
  r.rect(0, 0, jungnimConfig.screenWidth, jungnimConfig.screenHeight, ARENA_OUTSIDE);
  r.circle(cx, cy, radius, ARENA_BORDER);
  r.circle(cx, cy, radius - ARENA_BORDER_W, ARENA_FLOOR);
}

/** 떠 있는 아이템: 맥동하는 금색 원 + 십자 반짝임. 사라지기 직전엔 깜빡인다.
 *  전부 tick의 함수라 관전 화면에서도 같은 모습으로 보인다(렌더 전용 — 판정과 무관).
 *  아이템이 없으면 아무것도 안 그린다 — 부르는 쪽이 매번 확인하지 않게. */
export function drawItem(r: IRenderer, item: Item | null, worldTick: number): void {
  if (!item) return;
  const age = worldTick - item.bornTick;
  const left = item.expireTick - worldTick;
  // 곧 사라지는 동안 8tick 주기로 깜빡 — 한 프레임 걸러 그리지 않는다.
  if (left < ITEM_FADE_TICKS && Math.floor(left / 8) % 2 === 1) return;

  const pulse = 1 + Math.sin((age / ITEM_PULSE_TICKS) * Math.PI * 2) * ITEM_PULSE_AMOUNT;
  // 등장 직후엔 0에서 부풀어 오른다(ease-out). 탄막 한복판에 조용히 나타나면 못 본다.
  const pop = Math.min(1, age / ITEM_POP_TICKS);
  const radius = jungnimConfig.item.radius * pulse * pop * (2 - pop);
  const color = kindColor(item.kind); // 종류마다 색이 달라 멀리서도 무엇인지 안다
  r.circle(item.x, item.y, radius, color);
  const spike = radius + 5;
  r.line(item.x - spike, item.y, item.x + spike, item.y, color, 2);
  r.line(item.x, item.y - spike, item.x, item.y + spike, color, 2);
}

/** skip이 있으면 그 원 안의 화살은 안 그린다 — 남의 정화 파동을 내 화면에서 흉내 낼 때 쓴다.
 *  (그 사람은 실제로 지웠지만 내 공통 풀엔 남아 있다. 지우면 내 판정까지 바뀐다.) */
export function drawPool(
  r: IRenderer,
  pool: ArrowPool,
  skip?: { x: number; y: number; radius: number },
): void {
  const skip2 = skip ? skip.radius * skip.radius : 0;
  for (const a of pool.items) {
    if (!a.active) continue;
    if (skip) {
      const dx = a.x - skip.x;
      const dy = a.y - skip.y;
      if (dx * dx + dy * dy <= skip2) continue;
    }
    drawArrow(r, a);
  }
}

/** 화살 하나를 진행 방향(대각선 포함) 짧은 선으로 그린다. 색은 공통/개인 구분. */
function drawArrow(r: IRenderer, a: Arrow): void {
  const half = jungnimConfig.arrowLength / 2;
  const len = Math.hypot(a.vx, a.vy) || 1;
  const ux = (a.vx / len) * half;
  const uy = (a.vy / len) * half;
  r.line(a.x - ux, a.y - uy, a.x + ux, a.y + uy, a.personal ? PERSONAL_COLOR : ARROW_COLOR, 3);
}

/** 지금 퍼지고 있는 정화 파동의 반경(없으면 null). tick의 함수라 어느 화면에서든 같다. */
export function purgeRingRadius(src: PurgeSource): number | null {
  if (src.purgeFlash <= 0) return null;
  const { radius, ringTicks } = jungnimConfig.item.purge;
  const progress = 1 - src.purgeFlash / ringTicks; // 0(막 씀) → 1(끝)
  // 점이 아니라 **몸에서** 퍼져나간다 — 0에서 시작하면 첫 프레임이 한 점에 뭉쳐 얼룩처럼 보인다.
  const from = jungnimConfig.playerRadius;
  return from + (radius - from) * progress;
}

/** 정화 파동: 그 자리에서 금색 고리가 반경까지 퍼지며 옅어진다. */
export function drawPurgeRing(r: IRenderer, src: PurgeSource): void {
  const ring = purgeRingRadius(src);
  if (ring === null) return;
  const dot = 5 * (src.purgeFlash / jungnimConfig.item.purge.ringTicks);
  for (let i = 0; i < PURGE_RING_DOTS; i++) {
    const angle = ((Math.PI * 2) / PURGE_RING_DOTS) * i;
    r.circle(src.purgeX + Math.cos(angle) * ring, src.purgeY + Math.sin(angle) * ring, dot, kindColor("purge"));
  }
}
