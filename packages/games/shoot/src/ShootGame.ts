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
/** 남이 쏜 순간의 섬광이 남는 시간(tick). */
const FLASH_TICKS = 14;

/* ---- 쏘는 느낌 -----------------------------------------------------------
   2026-08-17 사용자가 실기기에서 "총을 쏜다는 느낌이 아니다, 반동도 있으면 좋겠다"고
   했다. ⚠️ 반동은 **이미 있었는데 너무 약했다**(8tick 동안 조준점이 살짝 벌어지는 정도).
   없는 것과 같았으므로 세 겹으로 다시 만든다: 반동 · 탄착 섬광 · 자국.

   (한동안 여기 "화면 흔들기는 일부러 안 넣었다"고 적혀 있었다. 아래 반동 항목 참조 —
    오프셋을 판정까지 통과시키면 흔들어도 거짓말이 되지 않는다는 걸 나중에 알았다.) */

/* ---- 반동 ---------------------------------------------------------------
   ⚠️ 한동안 화면 오른쪽 아래에 **총을 그려** 그놈이 뒤로 튀게 했었다.
      2026-08-17 사용자가 "총구는 빼줘"라고 해서 걷었다. 되살리지 말 것.

   ⚠️ **판을 흔든다. 그런데 거짓말이 아니다.** 한동안 "판을 흔들면 보고 누른 곳이
      빗나간다"고 적어 두고 안 흔들었는데, 그건 **그리기만 옮기고 판정은 그대로 둘 때**의
      이야기다. 여기서는 화면 좌표와 판 좌표 사이에 시야 오프셋(view)이 하나 있고,
      **그리기도 판정도 같은 오프셋을 지난다.** 그래서 눈에 보이는 표적을 누르면 언제나
      그 표적이 맞는다.
        화면 = 판 + view   ·   판 = 화면 - view
      조준점은 **오프셋을 안 지난다** — 마우스가 곧 조준점이라, 화면 좌표 그대로 찍힌다. */

/** 쏜 뒤 조준점이 벌어졌다 돌아오는 시간(tick). 22 ≈ 0.37초 — 눈에 남을 만큼 길다. */
const RECOIL_TICKS = 22;
/** 반동으로 조준점 팔이 벌어지는 최대 거리(px). */
const RECOIL_KICK = 26;
/** 쏜 자리의 탄착 섬광이 남는 시간(tick). 짧고 밝아야 «탕»과 맞물린다. */
const SPARK_TICKS = 6;
/** 명중했을 때 표적 자리에서 퍼지는 파열(tick). */
const BURST_TICKS = 14;
/** 빗맞힌 자국이 판에 남는 시간(tick). 180 = 3초 — 어디에 헛방을 냈는지 눈에 쌓인다. */
const HOLE_TICKS = 180;
/** 자국을 몇 개까지 들고 있을지. 넘치면 오래된 것부터 버린다. */
const MAX_SHOTS = 48;

/** 판 위에 잠깐 떠오르는 숫자. **순수 시각이라 판정과 무관하다.** */
type Mark = { x: number; y: number; tick: number; text: string; good: boolean };
/** 한 발이 남긴 자국(섬광·파열·탄흔). 역시 순수 시각이다. */
type Shot = { x: number; y: number; tick: number; hit: boolean };

export class ShootGame implements IGame {
  private seed = 0;
  private worldTick = 0;
  private state: ShootState = INITIAL;
  /** 조준점 = 손이 가리키는 **화면 좌표**. 반동이 여기 손대는 일은 없다. */
  private pointerX = C.screenWidth / 2;
  private pointerY = C.screenHeight / 2;
  /** 시야가 튄 양(px). 판을 이만큼 옮겨 그리고, 화면 좌표를 판 좌표로 되돌릴 때도 쓴다.
   *  매 tick 지수로 줄어든다. */
  private viewX = 0;
  private viewY = 0;
  /** 지금 몇 발째 연사인가. 쉬면 0으로 돌아간다 — 고정 궤적의 색인이다. */
  private burst = 0;
  /** 내가 이미 맞힌 표적 번호. **월드가 아니라 내 사정이다.** */
  private readonly hitIndexes = new Set<number>();

  /* 아래 다섯은 전부 연출이다 — tick으로만 굴러가고 난수를 쓰지 않는다. */
  private marks: Mark[] = [];
  private shots: Shot[] = [];
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
    this.pointerX = C.screenWidth / 2;
    this.pointerY = C.screenHeight / 2;
    this.viewX = 0;
    this.viewY = 0;
    this.burst = 0;
    this.hitIndexes.clear();
    this.marks = [];
    this.shots = [];
    this.firedAt = -999;
    this.pendingPeerEvent = null;
    this.peerShots.clear();
  }

  /** ⚠️ input을 안 받는다. 방향키는 아무 뜻이 없고, 진행은 aim·fire로만 일어난다.
   *  여기서 하는 일은 시계를 읽고 낡은 연출을 버리는 것뿐이다. */
  update(tick: number): void {
    this.worldTick = tick;
    if (this.marks.length > 0) this.marks = this.marks.filter((m) => tick - m.tick < MARK_TICKS);
    if (this.shots.length > 0) this.shots = this.shots.filter((s) => tick - s.tick < HOLE_TICKS);
    // 튄 시야가 제자리로 돌아온다. 지수라 처음엔 빠르고 끝에서 부드럽게 잦아든다.
    this.viewX *= C.recoilRecover;
    this.viewY *= C.recoilRecover;
    // 한동안 안 쐈으면 연사가 끊긴 것 — 다음 발은 다시 첫 발이다.
    if (this.worldTick - this.firedAt > C.recoilResetTicks) this.burst = 0;
  }

  aim(nx: number, ny: number): void {
    this.pointerX = nx * C.screenWidth;
    this.pointerY = ny * C.screenHeight;
  }

  /** 조준점이 **판의 어디를** 겨누고 있는가. 화면 좌표에서 시야 오프셋을 빼면 나온다.
   *  ⚠️ 맞히는 것도 관전에 싣는 것도 이 자리를 쓴다. 그려질 때 다시 오프셋이 더해지므로,
   *     눈에 보이는 표적을 누르면 언제나 그 표적이 맞는다. */
  private aimPoint(): { x: number; y: number } {
    return { x: this.pointerX - this.viewX, y: this.pointerY - this.viewY };
  }

  /** 한 발. ⚠️ 끝난 판에서는 아무것도 받지 않는다 — 시간이 다 된 뒤 도착한 한 발이
   *  점수를 바꾸면 결과 화면과 순위 기록이 어긋난다(숫자 야구·에임 추적과 같은 이유). */
  fire(nx: number, ny: number): void {
    if (isOver(this.worldTick)) return;
    // ⚠️ 넘어온 좌표는 **화면 좌표**다. 총알이 가는 곳은 그 아래 깔린 **판의** 어느
    //    자리이고, 그건 눈에 보이던 그 표적이다(시야가 튀어 있어도 마찬가지).
    this.pointerX = nx * C.screenWidth;
    this.pointerY = ny * C.screenHeight;
    const { x, y } = this.aimPoint();
    const outcome = shoot(this.state, this.standing(), x, y, this.worldTick);
    this.state = outcome.state;
    this.firedAt = this.worldTick;

    if (outcome.hit) this.hitIndexes.add(outcome.hit.index);
    // 맞았으면 **표적 한가운데**에 자국을 남긴다 — 조준이 테두리에 스쳤어도 파열은
    // 표적에서 터져야 "저걸 맞혔다"로 읽힌다.
    this.shots.push({
      x: outcome.hit ? outcome.hit.x : x,
      y: outcome.hit ? outcome.hit.y : y,
      tick: this.worldTick,
      hit: outcome.hit !== null,
    });
    if (this.shots.length > MAX_SHOTS) this.shots.shift();
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

    this.applyRecoil();
  }

  /** 한 발의 반동. 총구가 위로 들리므로 **판은 아래로 밀려 내려온다**(화면에서 +y).
   *  ⚠️ **세기는 몇 발째든 같다.** 연사수가 정하는 건 좌우로 흔들리는 순서뿐이다
   *     (config의 recoilKick 주석 참조 — 누적은 겪어 보고 걷어낸 설계다).
   *  ⚠️ 조준점은 안 건드린다 — 마우스가 곧 조준점이다. */
  private applyRecoil(): void {
    const kick = C.recoilKick;
    const drift = C.recoilDrift[this.burst % C.recoilDrift.length]!;
    this.viewY += kick;
    this.viewX -= kick * drift;
    // 상한은 **쌓인 총량**에도 건다. 안 그러면 길게 연사할 때 판이 화면 밖으로 나간다.
    this.viewY = Math.min(C.recoilMax, this.viewY);
    this.viewX = Math.min(C.recoilMax, Math.max(-C.recoilMax, this.viewX));
    this.burst++;
  }

  /** 지금 떠 있고 **아직 내가 안 맞힌** 표적들. 쏠 수 있는 것과 그려야 할 것이 같다. */
  private standing(): Target[] {
    return liveTargets(this.seed, this.worldTick).filter((t) => !this.hitIndexes.has(t.index));
  }

  /** 판 좌표 → 화면 좌표. **판에 속한 것은 전부 이걸 지난다**(배경만 시차로 덜 움직인다).
   *  ⚠️ 조준점만 예외다 — 그건 판이 아니라 손에 속한다. */
  private toScreenX(x: number): number {
    return x + this.viewX;
  }
  private toScreenY(y: number): number {
    return y + this.viewY;
  }

  render(r: IRenderer): void {
    const sinceFire = this.worldTick - this.firedAt;
    this.drawRange(r, C.backdropParallax);
    this.drawHoles(r); // 자국은 표적 **아래**에 깔린다 — 겨눌 것을 가리면 안 된다.
    for (const target of this.standing()) this.drawTarget(r, target);
    this.drawShots(r);
    this.drawMarks(r);
    // ⚠️ 조준점은 **손이 가리키는 화면 좌표 그대로**다. 판이 흔들려도 여기는 안 흔들린다.
    this.drawAim(r, this.pointerX, this.pointerY, sinceFire);
  }

  /** 남의 화면. a·b는 그 사람의 조준점이고 표적은 공통 월드라 여기서 다시 구한다.
   *  ⚠️ **남이 무엇을 맞혔는지는 모른다** — 맞힌 표적은 각자의 사정이고 관전 통로에는
   *     숫자 둘밖에 안 실린다. 그래서 지금 떠 있는 표적을 **전부** 그린다.
   *  ⚠️ 남이 쏜 순간만 따로 실려 온다(consumePeerEvent). 그걸로 **섬광만** 낸다 —
   *     표적을 지우지는 않는다. 어느 표적을 맞혔는지는 조준점으로 짐작할 수밖에 없는데,
   *     짐작이 틀리면 엉뚱한 표적이 사라져 관전자가 본 것이 거짓이 된다. */
  renderSpectator(r: IRenderer, target: SpectateTarget): void {
    // ⚠️ 관전 화면은 **내 시야가 튄 것을 따라가지 않는다.** 저 판은 남이 보고 있는 것이고,
    //    내가 쏜다고 남의 화면이 흔들릴 이유가 없다. a·b도 판 좌표로 와서 그대로 맞는다.
    const view = { x: this.viewX, y: this.viewY };
    this.viewX = 0;
    this.viewY = 0;
    this.drawRange(r, C.backdropParallax);
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
    this.viewX = view.x;
    this.viewY = view.y;
  }

  /** 사격장 바닥. **사각 격자가 아니라 동심원이다** — 에임 추적과 한눈에 갈리는 첫 단서다.
   *  ⚠️ IRenderer에는 테두리만 그리는 원이 없어서, 큰 원을 칠하고 안쪽을 배경색으로 도로
   *     덮어 고리를 만든다. 바깥 것부터 그려야 안쪽 덮기가 앞의 고리를 지우지 않는다. */
  private drawRange(r: IRenderer, parallax: number): void {
    r.rect(0, 0, C.screenWidth, C.screenHeight, BACKDROP);
    // ⚠️ 배경은 표적보다 **덜** 움직인다(시차). 가까운 것이 많이, 먼 것이 적게 움직이는
    //    것이 깊이감의 전부다 — 3D 없이 화면이 밀리는 느낌을 내는 값싼 수법이다.
    const cx = C.screenWidth / 2 + this.viewX * parallax;
    const cy = C.screenHeight / 2 + this.viewY * parallax;
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
    const x = this.toScreenX(target.x);
    const y = this.toScreenY(target.y);
    r.circle(x, y, C.radius * (APPROACH_FROM - (APPROACH_FROM - 1) * t), APPROACH);

    r.circle(x, y, C.radius, TARGET_RIM);
    r.circle(x, y, C.radius * 0.66, BACKDROP);
    r.circle(x, y, C.radius * 0.4, TARGET_RIM);
    r.circle(x, y, C.radius * 0.16, TARGET_CORE);
  }

  /** 빗맞힌 자리에 남는 탄흔. **오래 남는다**(3초) — 헛방에 소리를 안 붙였으므로
   *  어디에 헛방을 냈는지는 눈으로 쌓여야 한다. 맞힌 자리에는 안 남긴다(표적이 이미 없어졌다). */
  private drawHoles(r: IRenderer): void {
    for (const shot of this.shots) {
      if (shot.hit) continue;
      const age = (this.worldTick - shot.tick) / HOLE_TICKS;
      r.circle(this.toScreenX(shot.x), this.toScreenY(shot.y), 5,
        `rgba(120, 132, 126, ${(0.5 * (1 - age)).toFixed(3)})`);
    }
  }

  /** 한 발이 터지는 순간. 섬광은 짧고 밝게(«탕»과 맞물린다), 명중이면 파열이 이어진다. */
  private drawShots(r: IRenderer): void {
    for (const shot of this.shots) {
      const age = this.worldTick - shot.tick;
      if (age < SPARK_TICKS) {
        const t = age / SPARK_TICKS;
        r.circle(this.toScreenX(shot.x), this.toScreenY(shot.y), 22 * (1 - t) + 4,
          `rgba(255, 241, 205, ${(0.85 * (1 - t)).toFixed(3)})`);
      }
      if (shot.hit && age < BURST_TICKS) {
        const t = age / BURST_TICKS;
        r.circle(this.toScreenX(shot.x), this.toScreenY(shot.y), C.radius * (0.6 + t * 1.5),
          `rgba(144, 190, 109, ${(0.4 * (1 - t)).toFixed(3)})`);
      }
    }
  }

  /** 쏜 자리에 잠깐 떠오르는 숫자. 빨리 쏠수록 큰 수가 뜨는 걸 봐야 규칙이 몸에 붙는다. */
  private drawMarks(r: IRenderer): void {
    for (const mark of this.marks) {
      const age = (this.worldTick - mark.tick) / MARK_TICKS;
      r.text(mark.text, this.toScreenX(mark.x), this.toScreenY(mark.y) - 14 - age * 22,
        mark.good ? GOOD : BAD, 22, "center");
    }
  }

  /** 십자 조준점. **쏘면 크게 벌어졌다 돌아온다**(반동).
   *  ⚠️ 벌어지는 것은 **팔뿐이고 중심은 안 움직인다.** 조준점 자체를 위로 튕기면
   *     그리는 자리와 맞는 자리가 어긋나 — 화면이 규칙에 대해 거짓말을 한다.
   *  ⚠️ 되돌아오는 모양이 곧지 않다(제곱). 곧게 돌아오면 "늘었다 준다"로만 보이고,
   *     뒤로 갈수록 느려져야 «탕» 하고 튀었다 가라앉는 것으로 읽힌다. */
  private drawAim(r: IRenderer, x: number, y: number, sinceFire: number): void {
    const left = Math.max(0, RECOIL_TICKS - sinceFire) / RECOIL_TICKS;
    const kick = RECOIL_KICK * left * left;
    const gap = 5 + kick;
    const arm = 16 + kick;
    r.line(x - arm, y, x - gap, y, AIM, 2);
    r.line(x + gap, y, x + arm, y, AIM, 2);
    r.line(x, y - arm, x, y - gap, AIM, 2);
    r.line(x, y + gap, x, y + arm, AIM, 2);
    // 반동 중에는 가운데에 점을 찍어 **겨누는 자리가 어디인지** 잃지 않게 한다.
    if (kick > 1) r.circle(x, y, 2, AIM);
  }

  isPlayerDead(): boolean {
    return isOver(this.worldTick);
  }

  /** 관전 중계에 조준점을 싣는다 — a=x / b=y(에임 추적과 같은 뜻). */
  getPosition(): SpectateSignal {
    const aim = this.aimPoint();
    return { a: aim.x, b: aim.y };
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
