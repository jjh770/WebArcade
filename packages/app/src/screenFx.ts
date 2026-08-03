/* ============================================================
   screenFx — 메인 화면에 거는 연출
   ------------------------------------------------------------
   낙하·관전 전환·피격 디버프·발사 탄환. 전부 순수 CSS/DOM이라 게임 판정·결정론과
   무관하고, 전부 메인 캔버스(#game)와 그 컨테이너(#play)에만 건다 —
   살아있는 남의 사이드 뷰는 건드리지 않는다.

   AppView(화면·카드 렌더)와 갈라 둔 이유: 저쪽은 "무엇을 보여줄까"(상태 → DOM)이고
   여기는 "어떻게 움직일까"(같은 DOM에 시간축을 얹기)다. 섞이면 화면 전환 로직을
   읽을 때 애니메이션 재시작 트릭까지 매번 같이 읽어야 한다.

   ⚠️ 여기 반복되는 `void element.offsetWidth`는 리플로우 강제다. 같은 클래스를
      즉시 다시 붙여도 애니메이션이 재생되게 한다(연달아 죽거나 연달아 맞을 때).
   ============================================================ */

import { byId } from "./dom";

/* ---- 화면 전환 ------------------------------------------------------------ */

/** 죽는 순간: 내 화면이 아래로 떨어진다. */
export function fallScreen(): void {
  const el = byId("game");
  el.classList.remove("slide-in");
  el.classList.add("fallen");
}

/** 사망 임팩트: 화면을 짧게 흔들고 붉은 섬광을 번쩍인다(순수 시각). 낙하와 함께 부른다. */
export function deathFx(): void {
  const play = byId("play");
  const flash = byId("death-flash");
  play.classList.remove("shake");
  flash.classList.remove("flash");
  void play.offsetWidth;
  play.classList.add("shake");
  flash.classList.add("flash");
}

/** 관전 전환: 남의 화면이 위에서 미끄러져 들어온다. 낙하가 끝난 뒤 호출한다. */
export function slideInScreen(): void {
  const el = byId("game");
  el.classList.remove("fallen");
  el.classList.remove("slide-in");
  void el.offsetWidth;
  el.classList.add("slide-in");
}

/** 관전 대상을 넘길 때: 방향(+1 다음 / -1 이전)에 맞춰 좌우에서 밀려 들어온다. */
export function swapSpectateScreen(direction: number): void {
  const el = byId("game");
  el.classList.remove("swap-l", "swap-r");
  void el.offsetWidth;
  el.classList.add(direction > 0 ? "swap-r" : "swap-l");
}

/* ---- 피격 디버프 연출(victim 화면) ---------------------------------------
   남의 발사에 맞으면 "무엇에 맞았는지" 큰 배너로 알리고, 시각계 디버프(blur·shake·
   cloud)는 내 메인 화면에 직접 건다. 조작계(invert·sluggish)는 게임이 머리에 표시하고
   여기선 배너만 띄운다. */
const DEBUFF_META: Record<string, { icon: string; label: string }> = {
  // 게임마다 뒤집는 축이 다르다(커브=좌우 회전, 죽림고수=상하좌우) → 배너는 축을 안 박는다.
  invert: { icon: "⇄", label: "조작 반전" },
  sluggish: { icon: "🐌", label: "조작 둔화" },
  blur: { icon: "🌫️", label: "시야 흐림" },
  shake: { icon: "🌀", label: "화면 흔들림" },
  cloud: { icon: "☁️", label: "시야 가림" },
};
let debuffTimer = 0;

/** 시각 디버프 클래스/요소를 모두 내린다(라운드 리셋·중복 피격·정리용). */
function clearDebuffFx(): void {
  clearTimeout(debuffTimer);
  byId("game").classList.remove("debuff-blur");
  byId("play").classList.remove("debuff-shake");
  byId("debuff-cloud").classList.remove("on");
  byId("debuff-banner").classList.remove("on");
}

/** 남의 발사에 맞았다. kind에 맞는 배너 + 시각 디버프를 durationMs 동안 건다. */
export function debuffFx(kind: string, durationMs: number): void {
  const meta = DEBUFF_META[kind];
  if (!meta) return; // 모르는 디버프는 무시(옛 클라 안전)
  clearDebuffFx();

  // 배너 — 무엇에 맞았는지 화면 중앙에 크게 announce(짧게, 지속시간과 무관).
  const banner = byId("debuff-banner");
  banner.textContent = `${meta.icon} ${meta.label}!`;
  void banner.offsetWidth;
  banner.classList.add("on");

  // 시각계 디버프 본체 — durationMs 동안 유지하고 타이머로 내린다.
  if (kind === "blur") {
    byId("game").classList.add("debuff-blur");
  } else if (kind === "shake") {
    byId("play").classList.add("debuff-shake");
  } else if (kind === "cloud") {
    const cloud = byId("debuff-cloud");
    cloud.style.setProperty("--dur", `${durationMs}ms`);
    void cloud.offsetWidth;
    cloud.classList.add("on");
  }
  debuffTimer = window.setTimeout(clearDebuffFx, durationMs);
}

/* ---- 발사 연출(shooter 화면) ---------------------------------------------
   스릴 게이지를 채워 쐈을 때 **발사한 사람 화면에만** 보이는 연출. 내 메인 화면
   중앙에서 조준한 우측 관전창까지 탄환이 날아가 명중한다 — "저 사람을 맞혔다"를
   보여주는 게 목적이라 실제 디버프 적용(서버 릴레이)과는 완전히 별개다. */
const BULLET_FLIGHT_MS = 420;
const SLOT_HIT_MS = 500;
/** 아직 날아가는 중인 탄환들. 라운드가 끝나면 도착 전에 취소해야 한다. */
const bulletsInFlight = new Set<Animation>();

/** 명중: 맞은 관전창이 번쩍인다. */
function slotHitFx(slot: HTMLElement): void {
  slot.classList.remove("hit");
  void slot.offsetWidth;
  slot.classList.add("hit");
  window.setTimeout(() => slot.classList.remove("hit"), SLOT_HIT_MS);
}

/** 내가 쐈다. 메인 화면 중앙 → slotIndex번 관전창으로 탄환을 날리고 명중시킨다.
 *  좌표는 발사 때마다 레이아웃에서 직접 읽는다(창 크기·슬롯 개수가 계속 변한다). */
export function bulletFx(slotIndex: number, kind: string): void {
  const slot = document.getElementById(`slot-${slotIndex}`);
  if (!slot) return;
  const to = slot.getBoundingClientRect();
  if (to.width <= 0 || to.height <= 0) return; // 좁은 화면 = 관전 칼럼이 접힘 → 쏠 곳이 없다
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    slotHitFx(slot); // 모션 민감 사용자에겐 날리지 않고 명중만 알린다
    return;
  }

  const from = byId("game").getBoundingClientRect();
  const originX = from.left + from.width / 2;
  const originY = from.top + from.height / 2;
  const dx = to.left + to.width / 2 - originX;
  const dy = to.top + to.height / 2 - originY;

  const bullet = document.createElement("div");
  bullet.className = "fire-bullet";
  bullet.textContent = DEBUFF_META[kind]?.icon ?? "✦"; // 무슨 디버프를 쐈는지 탄환이 들고 간다
  bullet.style.left = `${originX}px`;
  bullet.style.top = `${originY}px`;
  document.body.appendChild(bullet);

  const flight = bullet.animate(
    [
      { transform: "translate(-50%, -50%) scale(.5) rotate(0deg)", opacity: 0.35 },
      {
        transform: `translate(calc(${dx}px - 50%), calc(${dy}px - 50%)) scale(1.15) rotate(320deg)`,
        opacity: 1,
      },
    ],
    { duration: BULLET_FLIGHT_MS, easing: "cubic-bezier(.45,0,.75,.6)" },
  );
  bulletsInFlight.add(flight);
  flight.onfinish = () => {
    bulletsInFlight.delete(flight);
    bullet.remove();
    // 날아가는 동안 그 슬롯이 비었으면(상대 사망 등) 명중 연출은 생략한다.
    if (slot.classList.contains("on")) slotHitFx(slot);
  };
  flight.oncancel = () => {
    bulletsInFlight.delete(flight);
    bullet.remove();
  };
}

/** 날아가던 탄환을 즉시 치운다(라운드 종료·로비 복귀). */
function clearBullets(): void {
  for (const flight of [...bulletsInFlight]) flight.cancel(); // oncancel이 요소를 지운다
  bulletsInFlight.clear();
}

/** 새 라운드·로비 복귀 등 연출을 모두 지우고 캔버스를 기본 상태로. */
export function resetScreenFx(): void {
  byId("game").classList.remove("fallen", "slide-in", "swap-l", "swap-r");
  clearDebuffFx();
  clearBullets();
}
