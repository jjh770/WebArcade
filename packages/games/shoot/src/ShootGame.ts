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

   판정은 전부 순수 함수다(targets·rules). 여기 있는 건 화면과 입력뿐이다.
   ⚠️ 그리기는 아직 **최소한**이다. 제대로 된 화면·관전은 3단계에서 한다.
      특히 **에임 추적과 닮아 보이지 않게** 하는 일이 거기 남아 있다.
   ============================================================ */

import type { IGame, IRenderer, SpectateSignal, SpectateTarget } from "@arcade/shared";
import { shootConfig as C } from "./config";
import { INITIAL, accuracyOf, isOver, shoot, ticksLeft, type ShootState } from "./rules";
import { liveTargets, type Target } from "./targets";

const BACKDROP = "#141a17";
const GRID = "#1d2521";
const TARGET = "#f4a261";
const AIM = "#e8eef2";
const DIM = "#8b95a3";

export class ShootGame implements IGame {
  private seed = 0;
  private worldTick = 0;
  private state: ShootState = INITIAL;
  private aimX = C.screenWidth / 2;
  private aimY = C.screenHeight / 2;
  /** 내가 이미 맞힌 표적 번호. **월드가 아니라 내 사정이다** — 출현표는 모두에게 같고
   *  여기만 사람마다 다르다. */
  private readonly hitIndexes = new Set<number>();

  init(seed: number): void {
    this.seed = seed;
    this.worldTick = 0;
    this.state = INITIAL;
    this.aimX = C.screenWidth / 2;
    this.aimY = C.screenHeight / 2;
    this.hitIndexes.clear();
  }

  /** ⚠️ input을 안 받는다. 방향키는 아무 뜻이 없고, 진행은 aim·fire로만 일어난다.
   *  여기서 하는 일은 시계를 읽는 것뿐이다 — 표적은 시드가 알아서 뜨고 진다. */
  update(tick: number): void {
    this.worldTick = tick;
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
    if (outcome.hit) this.hitIndexes.add(outcome.hit.index);
  }

  /** 지금 떠 있고 **아직 내가 안 맞힌** 표적들. 쏠 수 있는 것과 그려야 할 것이 같다. */
  private standing(): Target[] {
    return liveTargets(this.seed, this.worldTick).filter((t) => !this.hitIndexes.has(t.index));
  }

  render(r: IRenderer): void {
    this.drawField(r);
    for (const target of this.standing()) r.circle(target.x, target.y, C.radius, TARGET);
    this.drawAim(r, this.aimX, this.aimY);
  }

  /** 남의 화면. a·b는 그 사람의 조준점이고 표적은 공통 월드라 여기서 다시 구한다.
   *  ⚠️ **남이 무엇을 맞혔는지는 모른다** — 맞힌 표적은 각자의 사정이고 관전 통로에는
   *     숫자 둘밖에 안 실린다. 그래서 남의 화면에는 **아직 안 맞힌 것까지 포함해** 지금
   *     떠 있는 표적을 전부 그린다. 모르는 것을 아는 척 그리지 않는다.
   *     (남이 맞히는 순간을 보여 주는 일은 3단계에서 consumePeerEvent로 따로 볼 것.) */
  renderSpectator(r: IRenderer, target: SpectateTarget): void {
    this.drawField(r);
    for (const spot of liveTargets(this.seed, this.worldTick)) {
      r.circle(spot.x, spot.y, C.radius, TARGET);
    }
    this.drawAim(r, target.a, target.b);
    r.text(target.label, C.screenWidth / 2, 52, DIM, 22, "center");
  }

  private drawField(r: IRenderer): void {
    r.rect(0, 0, C.screenWidth, C.screenHeight, BACKDROP);
    for (let i = 1; i < 4; i++) {
      const at = (C.screenWidth / 4) * i;
      r.line(at, 0, at, C.screenHeight, GRID, 1);
      r.line(0, at, C.screenWidth, at, GRID, 1);
    }
    const left = ticksLeft(this.worldTick) / C.timeLimitTicks;
    r.rect(0, 0, C.screenWidth, 7, GRID);
    r.rect(0, 0, C.screenWidth * left, 7, DIM);
  }

  private drawAim(r: IRenderer, x: number, y: number): void {
    const arm = 16;
    const gap = 5;
    r.line(x - arm, y, x - gap, y, AIM, 2);
    r.line(x + gap, y, x + arm, y, AIM, 2);
    r.line(x, y - arm, x, y - gap, AIM, 2);
    r.line(x, y + gap, x, y + arm, AIM, 2);
  }

  isPlayerDead(): boolean {
    return isOver(this.worldTick);
  }

  /** 관전 중계에 조준점을 싣는다 — a=x / b=y(에임 추적과 같은 뜻).
   *  표적은 시드로 정해져 남의 화면에서도 똑같이 구할 수 있다. */
  getPosition(): SpectateSignal {
    return { a: this.aimX, b: this.aimY };
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
