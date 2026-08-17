/* ============================================================
   ShootGame — 에임 사격. IGame 구현. (여섯 번째 게임)
   ------------------------------------------------------------
   다섯 번째(에임 추적)와 입력도 판도 같지만 **재는 능력이 다르다.** 저쪽은 움직이는
   표적을 놓치지 않고 붙드는 힘이고, 이쪽은 뜨는 순간 정확히 찍는 힘이다.

   1) **누른 순간이 필요하다.** 조준 좌표만으로는 같은 자리에서 두 번 쏜 것과 한 번 쏜
      것이 구별되지 않는다. IGame에 fire를 하나 열었다(계약 파일 주석 참조).

   2) **출현표는 내 사격에 좌우되지 않는다.** 맞히면 다음이 뜨는 방식이 아니라 시드가
      정한 시각에 뜬다(targets.ts 머리말). 그래서 같은 방의 모두가 같은 판을 본다.

   3) **맞힌 표적은 내 화면에서만 사라진다.** 그게 이 게임에서 사람마다 다른 유일한
      것이고, 그래서 `hitIndexes`가 여기(게임 인스턴스)에 산다 — 월드가 아니다.

   ⚠️ **화면은 에임 추적과 닮지 않게 그린다.** 입력도 판 크기도 같아서 그냥 두면 두
      게임이 같아 보인다. 그래서 갈라 둔 것들:
        · 배경     — 저쪽은 사각 격자, 여기는 **사격장 동심원**
        · 표적     — 저쪽은 부드러운 링 하나, 여기는 **과녁**(테–사이–중심)
        · 색       — 저쪽은 빨강/초록(붙들었나), 여기는 주황 계열 하나
        · 움직임   — 저쪽은 표적이 흐르고, 여기는 **수명 고리가 조여든다**
      마지막 것이 특히 중요하다: 고리가 클수록 점수가 높다는 규칙이 그대로 눈에 보인다.
   ============================================================ */

import type { IGame, IRenderer, SpectateSignal, SpectateTarget } from "@arcade/shared";
import { shootConfig as C } from "./config";
import { INITIAL, accuracyOf, isOver, shoot, ticksLeft, type ShootState } from "./rules";
import { liveTargets, type Target } from "./targets";

const BACKDROP = "#141a17";
const RANGE_RING = "#1f2a24"; // 사격장 바닥의 사거리 표시
const TARGET_RIM = "#f4a261";
const TARGET_CORE = "#e63946";
const APPROACH = "rgba(244, 162, 97, 0.16)"; // 조여드는 수명 고리
const AIM = "#e8eef2";
const GOOD = "#90be6d";
const BAD = "#e63946";
const DIM = "#8b95a3";
const TIME_LOW = "#e63946";

/** 수명 고리가 시작하는 크기(표적 반지름 대비). 여기서 표적 크기까지 조여든다. */
const APPROACH_FROM = 2.8;
/** 맞힘·헛방 숫자가 떠 있는 시간(tick). 40 ≈ 0.67초. */
const MARK_TICKS = 40;
/** 쏜 뒤 조준점이 벌어졌다 돌아오는 시간(tick). */
const RECOIL_TICKS = 8;
/** 남이 쏜 순간의 섬광이 남는 시간(tick). */
const FLASH_TICKS = 14;

/** 판 위에 잠깐 떠오르는 숫자. **순수 시각이라 판정과 무관하다.** */
type Mark = { x: number; y: number; tick: number; text: string; good: boolean };

export class ShootGame implements IGame {
  private seed = 0;
  private worldTick = 0;
  private state: ShootState = INITIAL;
  private aimX = C.screenWidth / 2;
  private aimY = C.screenHeight / 2;
  /** 내가 이미 맞힌 표적 번호. **월드가 아니라 내 사정이다.** */
  private readonly hitIndexes = new Set<number>();

  /* 아래 넷은 전부 연출이다 — tick으로만 굴러가고 난수를 쓰지 않는다. */
  private marks: Mark[] = [];
  private firedAt = -999;
  private pendingPeerEvent: string | null = null;
  /** 남이 쏜 순간(id → {tick, 맞았나}). 관전 화면의 섬광에만 쓴다. */
  private readonly peerShots = new Map<string, { tick: number; hit: boolean }>();
  private readonly sounds = new Set<string>();

  init(seed: number): void {
    this.sounds.clear();
    this.seed = seed;
    this.worldTick = 0;
    this.state = INITIAL;
    this.aimX = C.screenWidth / 2;
    this.aimY = C.screenHeight / 2;
    this.hitIndexes.clear();
    this.marks = [];
    this.firedAt = -999;
    this.pendingPeerEvent = null;
    this.peerShots.clear();
  }

  /** ⚠️ input을 안 받는다. 방향키는 아무 뜻이 없고, 진행은 aim·fire로만 일어난다.
   *  여기서 하는 일은 시계를 읽고 낡은 연출을 버리는 것뿐이다. */
  update(tick: number): void {
    this.worldTick = tick;
    if (this.marks.length > 0) this.marks = this.marks.filter((m) => tick - m.tick < MARK_TICKS);
  }

  aim(nx: number, ny: number): void {
    this.aimX = nx * C.screenWidth;
    this.aimY = ny * C.screenHeight;
  }

  /** 한 발. ⚠️ 끝난 판에서는 아무것도 받지 않는다 — 시간이 다 된 뒤 도착한 한 발이
   *  점수를 바꾸면 결과 화면과 순위 기록이 어긋난다(숫자 야구·에임 추적과 같은 이유). */
  fire(nx: number, ny: number): void {
    if (isOver(this.worldTick)) return;
    const x = nx * C.screenWidth;
    const y = ny * C.screenHeight;
    const outcome = shoot(this.state, this.standing(), x, y, this.worldTick);
    this.state = outcome.state;
    this.firedAt = this.worldTick;

    if (outcome.hit) this.hitIndexes.add(outcome.hit.index);
    this.marks.push({
      x,
      y,
      tick: this.worldTick,
      // 점수가 0에 붙어 있으면 헛방이어도 실제로는 안 깎인다. 그때 "-30"을 띄우면
      // 화면이 규칙에 대해 거짓말을 한다.
      text: outcome.hit ? `+${outcome.gained}` : outcome.gained < 0 ? `${outcome.gained}` : "빗나감",
      good: outcome.hit !== null,
    });
    // 총성은 **맞든 안 맞든** 난다. 맞았을 때만 확인음이 그 위에 얹힌다 —
    // 아무 반응 없이 총성만 나는 것이 곧 빗나감이다(audio.ts의 shot 주석 참조).
    this.sounds.add("shot");
    if (outcome.hit) this.sounds.add("pop");
    // 남들 화면에 한 번 실려 갈 연출 신호. **판정이 아니다** — 유실돼도 진행은 안 갈린다.
    this.pendingPeerEvent = outcome.hit ? "h" : "m";
  }

  /** 지금 떠 있고 **아직 내가 안 맞힌** 표적들. 쏠 수 있는 것과 그려야 할 것이 같다. */
  private standing(): Target[] {
    return liveTargets(this.seed, this.worldTick).filter((t) => !this.hitIndexes.has(t.index));
  }

  render(r: IRenderer): void {
    this.drawRange(r);
    for (const target of this.standing()) this.drawTarget(r, target);
    this.drawMarks(r);
    this.drawAim(r, this.aimX, this.aimY, this.worldTick - this.firedAt);
  }

  /** 남의 화면. a·b는 그 사람의 조준점이고 표적은 공통 월드라 여기서 다시 구한다.
   *  ⚠️ **남이 무엇을 맞혔는지는 모른다** — 맞힌 표적은 각자의 사정이고 관전 통로에는
   *     숫자 둘밖에 안 실린다. 그래서 지금 떠 있는 표적을 **전부** 그린다.
   *  ⚠️ 남이 쏜 순간만 따로 실려 온다(consumePeerEvent). 그걸로 **섬광만** 낸다 —
   *     표적을 지우지는 않는다. 어느 표적을 맞혔는지는 조준점으로 짐작할 수밖에 없는데,
   *     짐작이 틀리면 엉뚱한 표적이 사라져 관전자가 본 것이 거짓이 된다. */
  renderSpectator(r: IRenderer, target: SpectateTarget): void {
    this.drawRange(r);
    for (const spot of liveTargets(this.seed, this.worldTick)) this.drawTarget(r, spot);

    const shot = this.peerShots.get(target.id);
    const age = shot ? this.worldTick - shot.tick : Infinity;
    if (age >= 0 && age < FLASH_TICKS) {
      const t = age / FLASH_TICKS;
      const alpha = (0.5 * (1 - t)).toFixed(3);
      const tint = shot!.hit ? `rgba(144, 190, 109, ${alpha})` : `rgba(230, 57, 70, ${alpha})`;
      r.circle(target.a, target.b, 10 + t * 26, tint);
    }
    this.drawAim(r, target.a, target.b, age);
    r.text(target.label, C.screenWidth / 2, 52, DIM, 22, "center");
  }

  /** 사격장 바닥. **사각 격자가 아니라 동심원이다** — 에임 추적과 한눈에 갈리는 첫 단서다.
   *  ⚠️ IRenderer에는 테두리만 그리는 원이 없어서, 큰 원을 칠하고 안쪽을 배경색으로 도로
   *     덮어 고리를 만든다. 바깥 것부터 그려야 안쪽 덮기가 앞의 고리를 지우지 않는다. */
  private drawRange(r: IRenderer): void {
    r.rect(0, 0, C.screenWidth, C.screenHeight, BACKDROP);
    const cx = C.screenWidth / 2;
    const cy = C.screenHeight / 2;
    for (const radius of [330, 220, 110]) {
      r.circle(cx, cy, radius, RANGE_RING);
      r.circle(cx, cy, radius - 2, BACKDROP);
    }
    const left = ticksLeft(this.worldTick) / C.timeLimitTicks;
    r.rect(0, 0, C.screenWidth, 7, RANGE_RING);
    r.rect(0, 0, C.screenWidth * left, 7, left <= 5 / 30 ? TIME_LOW : DIM);
  }

  /** 과녁 하나 + 조여드는 수명 고리.
   *  ⚠️ 고리가 클수록 남은 점수가 크다 — 점수 규칙이 그대로 눈에 보이게 한 것이라,
   *     크기를 바꿀 때 config의 speedBonus와 뜻이 어긋나지 않게 할 것. */
  private drawTarget(r: IRenderer, target: Target): void {
    const life = target.life <= 0 ? 1 : (this.worldTick - target.bornTick) / target.life;
    const t = Math.min(1, Math.max(0, life));
    r.circle(target.x, target.y, C.radius * (APPROACH_FROM - (APPROACH_FROM - 1) * t), APPROACH);

    r.circle(target.x, target.y, C.radius, TARGET_RIM);
    r.circle(target.x, target.y, C.radius * 0.66, BACKDROP);
    r.circle(target.x, target.y, C.radius * 0.4, TARGET_RIM);
    r.circle(target.x, target.y, C.radius * 0.16, TARGET_CORE);
  }

  /** 쏜 자리에 잠깐 떠오르는 숫자. 빨리 쏠수록 큰 수가 뜨는 걸 봐야 규칙이 몸에 붙는다. */
  private drawMarks(r: IRenderer): void {
    for (const mark of this.marks) {
      const age = (this.worldTick - mark.tick) / MARK_TICKS;
      r.text(mark.text, mark.x, mark.y - 14 - age * 22, mark.good ? GOOD : BAD, 22, "center");
    }
  }

  /** 십자 조준점. **쏘면 잠깐 벌어졌다 돌아온다**(반동) — 누른 게 먹혔다는 걸 손이 아니라
   *  눈으로도 알아야 한다. 에임 추적의 조준점은 상태로 색이 바뀌고, 이쪽은 움직인다. */
  private drawAim(r: IRenderer, x: number, y: number, sinceFire: number): void {
    const kick = Math.max(0, RECOIL_TICKS - sinceFire);
    const gap = 5 + kick;
    const arm = 16 + kick * 1.5;
    r.line(x - arm, y, x - gap, y, AIM, 2);
    r.line(x + gap, y, x + arm, y, AIM, 2);
    r.line(x, y - arm, x, y - gap, AIM, 2);
    r.line(x, y + gap, x, y + arm, AIM, 2);
  }

  isPlayerDead(): boolean {
    return isOver(this.worldTick);
  }

  /** 관전 중계에 조준점을 싣는다 — a=x / b=y(에임 추적과 같은 뜻). */
  getPosition(): SpectateSignal {
    return { a: this.aimX, b: this.aimY };
  }

  /** 방금 쏜 사실을 남들 화면에 한 번 실어 보낸다(`h` 맞힘 · `m` 헛방).
   *  ⚠️ 연출 전용이다. 유실돼도 점수도 표적도 안 갈린다. */
  consumePeerEvent(): string | null {
    const event = this.pendingPeerEvent;
    this.pendingPeerEvent = null;
    return event;
  }

  /** 남이 쏘았다. 그 사람을 관전 중일 때 섬광으로 재현한다. 모르는 kind는 무시한다. */
  applyPeerEvent(id: string, kind: string): void {
    if (kind !== "h" && kind !== "m") return;
    this.peerShots.set(id, { tick: this.worldTick, hit: kind === "h" });
  }

  consumeSounds(): readonly string[] | null {
    if (this.sounds.size === 0) return null;
    const out = [...this.sounds];
    this.sounds.clear();
    return out;
  }

  getScore(): number {
    return this.state.score;
  }

  /** 명중률(0~1). 시간이나 배수가 아니라 **얼마나 아껴 쐈는가**를 보여 준다 —
   *  이 게임에서 사람이 지키려 애쓰는 것이 그것이다. */
  getGauge(): number {
    return accuracyOf(this.state);
  }
}
