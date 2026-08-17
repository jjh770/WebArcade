/* ============================================================
   AimGame — 에임 추적. IGame 구현. (다섯 번째 게임)
   ------------------------------------------------------------
   앞의 넷과 다른 점이 이 게임의 존재 이유다.

   1) **입력이 좌표다.** 방향 넷은 「어느 쪽으로 가는가」고 조준은 「어디를 보는가」다.
      IGame에 aim을 하나 열었다(계약 파일 주석 참조). 좌표는 판 기준 0~1로 오고
      여기서 게임 좌표로 바꾼다 — core는 이 게임의 판 크기를 모른다.

   2) **월드가 플레이어와 완전히 무관하다.** 표적 경로는 시드와 tick만으로 정해진다
      (targetPath). 잘 겨눈다고 표적이 달라지지 않으므로 같은 방의 모두가 같은 판을
      본다 — 네 게임 중 어긋날 여지가 가장 적다.

   3) **죽음이 없다.** 끝은 시간뿐이고, 그래서 한 방의 모두가 같은 순간에 끝난다.
      ⚠️ 그렇다고 renderSpectator가 노는 건 아니다 — 살아 있는 동안 옆 슬롯에 뜨는
         남의 화면이 그 함수로 그려진다.

   판정은 전부 순수 함수다(targetPath·rules). 여기 있는 건 화면과 입력뿐이다.

   ⚠️ **화면이 말해야 하는 것 셋**이 있고, 셋 다 규칙에 있지만 눈에 안 보이면 없는 것과
      같다: ① 지금 붙들고 있는가 ② 놓쳤지만 **아직 유예 안인가** ③ 시간이 얼마 남았는가.
      특히 ②는 이 게임의 공정성 장치인데(rules 주석), 보여 주지 않으면 사람은 그런 게
      있는 줄도 모르고 놓치는 순간 손을 놓아 버린다.
   ============================================================ */

import type { IGame, IRenderer, SpectateSignal, SpectateTarget } from "@arcade/shared";
import { aimConfig as C } from "./config";
import { INITIAL, comboOf, comboGauge, isHit, isOver, step, ticksLeft, type AimState } from "./rules";
import { targetAt, type TargetAt } from "./targetPath";

const BACKDROP = "#15171d";
const GRID = "#1e2129";
const HELD = "#90be6d"; // 붙들고 있다
const GRACE = "#f4a261"; // 놓쳤지만 아직 유예 안이다
const LOST = "#e8eef2"; // 놓쳤다
const TARGET = "#e63946";
const DIM = "#8b95a3";
const TIME_LOW = "#e63946";

/** 표적을 옅게 깐 뒤 가운데를 진하게 찍는다. 꽉 찬 원으로 그리면 뒤의 격자가 가려져
 *  판 위 어디쯤인지 가늠이 안 되고, 큰 원 하나는 가장자리와 중심이 같은 값이라
 *  "어디를 겨눠야 정확한가"가 안 보인다. */
const TARGET_FILL = "rgba(230, 57, 70, 0.22)";
const TARGET_FILL_HELD = "rgba(144, 190, 109, 0.26)";
/** 안쪽 점의 크기(반지름 대비). */
const CORE = 0.34;

/** 배수가 오른 순간의 파문이 퍼지는 시간(tick). */
const RIPPLE_TICKS = 14;

export class AimGame implements IGame {
  private seed = 0;
  private worldTick = 0;
  private state: AimState = INITIAL;
  /** 조준점(게임 좌표). 판 한가운데에서 시작한다 — 표적도 거기서 출발하므로
   *  첫 순간부터 겨누고 있는 셈이고, 시작하자마자 놓친 상태로 서 있지 않는다. */
  private aimX = C.screenWidth / 2;
  private aimY = C.screenHeight / 2;
  /** 배수가 마지막으로 오른 tick. 파문 연출에만 쓴다 — 판정과 무관하다. */
  private comboUpAt = -999;
  private readonly sounds = new Set<string>();

  init(seed: number): void {
    this.seed = seed;
    this.worldTick = 0;
    this.state = INITIAL;
    this.aimX = C.screenWidth / 2;
    this.aimY = C.screenHeight / 2;
    this.comboUpAt = -999;
    this.sounds.clear();
  }

  /** ⚠️ input을 안 받는다. 이 게임에서 방향키는 아무 뜻이 없고, 조준은 aim으로만 들어온다.
   *  여기서 하는 일은 시계를 읽고 이번 tick의 적중을 한 번 세는 것뿐이다. */
  update(tick: number): void {
    this.worldTick = tick;
    // 끝난 판에서는 더 세지 않는다 — 시간이 다 된 뒤의 한 프레임이 점수를 더 올리면
    // 결과 화면과 순위 기록이 어긋난다(숫자 야구와 같은 이유).
    if (isOver(tick)) return;

    const before = this.state;
    this.state = step(before, isHit(this.aimX, this.aimY, targetAt(this.seed, tick)));

    // 소리는 **단계가 바뀐 순간에만** 낸다. 매 tick 나는 사건(적중·빗나감)에 소리를 달면
    // 45초 내내 울려 판을 덮는다.
    const rose = comboOf(this.state) > comboOf(before);
    if (rose) {
      this.comboUpAt = tick;
      this.sounds.add("lock");
    }
    // 유예를 넘겨 쌓아 둔 시간이 사라진 순간. 잠깐 놓친 것마다 울리지 않는다.
    if (before.holdTicks > 0 && this.state.holdTicks === 0) this.sounds.add("slip");
  }

  /** 조준점이 움직였다. 판 기준 0~1이 게임 좌표로 바뀌는 곳은 여기뿐이다.
   *  ⚠️ 고정 스텝 밖에서 온다. 여기서는 자리만 적어 두고, 그 자리가 점수가 되는 건
   *     다음 update다 — 한 tick에 여러 번 움직여도 점수는 한 번만 오른다. */
  aim(nx: number, ny: number): void {
    this.aimX = nx * C.screenWidth;
    this.aimY = ny * C.screenHeight;
  }

  render(r: IRenderer): void {
    const spot = targetAt(this.seed, this.worldTick);
    this.drawField(r);
    this.drawTime(r);
    this.drawTarget(r, spot, this.holding());
    this.drawRipple(r, spot);
    this.drawAim(r, this.aimX, this.aimY, this.mood(), comboOf(this.state));
  }

  /** 남의 화면. **a·b는 그 사람의 조준점**이고 표적은 공통 월드라 여기서 다시 구한다
   *  — 그래서 남의 화면에도 같은 표적이 같은 자리에 있고, 다른 것은 조준점뿐이다.
   *  ⚠️ getPosition이 싣는 뜻과 여기서 읽는 뜻은 한 쌍이다. 한쪽만 고치면 안 된다.
   *  ⚠️ 남의 배수·유예는 **모른다**(통로에 실리는 건 숫자 둘뿐이다). 그래서 남의 조준점은
   *     맞았나 아닌가 두 가지로만 칠한다 — 모르는 것을 아는 척 그리지 않는다. */
  renderSpectator(r: IRenderer, target: SpectateTarget): void {
    const spot = targetAt(this.seed, this.worldTick);
    this.drawField(r);
    this.drawTime(r);
    this.drawTarget(r, spot, isHit(target.a, target.b, spot));
    this.drawAim(r, target.a, target.b, isHit(target.a, target.b, spot) ? HELD : LOST, 1);
    r.text(target.label, C.screenWidth / 2, 52, DIM, 22, "center");
  }

  /** 지금 표적을 붙들고 있는가(이번 tick에 맞았는가). */
  private holding(): boolean {
    return this.state.missTicks === 0;
  }

  /** 조준점을 칠할 색 — 화면이 말해야 하는 세 상태 중 둘이 여기서 갈린다. */
  private mood(): string {
    if (this.holding()) return HELD;
    // 놓쳤지만 아직 배수가 살아 있는 구간. **여기서 다시 잡으면 이어진다**는 걸
    // 색으로 알려 준다 — 이 짧은 순간이 보이지 않으면 유예는 없는 규칙이나 같다.
    return this.state.missTicks <= C.comboGraceTicks && this.state.holdTicks > 0 ? GRACE : LOST;
  }

  private drawField(r: IRenderer): void {
    r.rect(0, 0, C.screenWidth, C.screenHeight, BACKDROP);
    // 겨눌 자리를 가늠하게 해 주는 최소한의 격자. 표적만 떠 있으면 거리감이 없다.
    for (let i = 1; i < 4; i++) {
      const at = (C.screenWidth / 4) * i;
      r.line(at, 0, at, C.screenHeight, GRID, 1);
      r.line(0, at, C.screenWidth, at, GRID, 1);
    }
  }

  /** 남은 시간 막대. **HUD 게이지가 시간이 아니라 집중을 보여 주므로** 시간은 판 위에서
   *  말해야 한다 — 45초가 언제 끝나는지 모르는 채로 좇게 두면 마지막 10초를 못 쥐어짠다. */
  private drawTime(r: IRenderer): void {
    const left = ticksLeft(this.worldTick) / C.timeLimitTicks;
    const low = left <= 10 / 45; // 마지막 10초
    r.rect(0, 0, C.screenWidth, 7, GRID);
    r.rect(0, 0, C.screenWidth * left, 7, low ? TIME_LOW : DIM);
  }

  private drawTarget(r: IRenderer, spot: TargetAt, held: boolean): void {
    r.circle(spot.x, spot.y, spot.radius, held ? TARGET_FILL_HELD : TARGET_FILL);
    r.circle(spot.x, spot.y, spot.radius * CORE, held ? HELD : TARGET);
  }

  /** 배수가 오른 순간 표적에서 퍼지는 파문. 순수 시각 효과다 —
   *  ⚠️ tick으로만 굴러가고 난수를 쓰지 않는다(SeededRNG 주석의 금지 사항). */
  private drawRipple(r: IRenderer, spot: TargetAt): void {
    const age = this.worldTick - this.comboUpAt;
    if (age < 0 || age >= RIPPLE_TICKS) return;
    const t = age / RIPPLE_TICKS;
    const alpha = (0.35 * (1 - t)).toFixed(3);
    r.circle(spot.x, spot.y, spot.radius * (1 + t * 1.6), `rgba(144, 190, 109, ${alpha})`);
  }

  /** 십자 조준점. 배수가 1보다 크면 곁에 배수를 적는다 — 게이지는 화면 밖 HUD에 있어
   *  표적을 좇는 눈에는 안 들어온다. */
  private drawAim(r: IRenderer, x: number, y: number, color: string, combo: number): void {
    const arm = 16;
    const gap = 5; // 가운데를 비운다 — 십자가 표적 중심을 덮으면 정작 겨눌 곳이 안 보인다.
    r.line(x - arm, y, x - gap, y, color, 2);
    r.line(x + gap, y, x + arm, y, color, 2);
    r.line(x, y - arm, x, y - gap, color, 2);
    r.line(x, y + gap, x, y + arm, color, 2);
    if (combo > 1) r.text(`×${combo}`, x + arm + 6, y + 6, color, 20);
  }

  isPlayerDead(): boolean {
    return isOver(this.worldTick);
  }

  /** 관전 중계에 **조준점을 싣는다** — a=x / b=y(게임 좌표).
   *  표적은 시드로 정해져 남의 화면에서도 똑같이 구할 수 있으니, 사람마다 다른 것은
   *  조준점뿐이다. ⚠️ 이 값은 보간돼 도착한다(SpectateSignal). 좌표라 보간이 자연스럽다. */
  getPosition(): SpectateSignal {
    return { a: this.aimX, b: this.aimY };
  }

  /* syncPeers는 구현하지 않는다 — 남의 화면에 쌓을 로컬 시각 요소가 없다.
     관전에 필요한 숫자 둘은 SpectateTarget에 이미 실려 온다(선택 계약). */

  consumeSounds(): readonly string[] | null {
    if (this.sounds.size === 0) return null;
    const out = [...this.sounds];
    this.sounds.clear();
    return out;
  }

  getScore(): number {
    return this.state.score;
  }

  /** 배수가 얼마나 차올랐는가(0~1). 남은 시간이 아니라 **집중**을 보여 준다 —
   *  시간은 어차피 모두에게 같고, 이 판에서 사람이 지키려 애쓰는 건 배수다. */
  getGauge(): number {
    return comboGauge(this.state);
  }
}
