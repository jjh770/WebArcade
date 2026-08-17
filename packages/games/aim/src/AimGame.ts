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
   ⚠️ 그리기는 아직 **최소한**이다. 제대로 된 화면·관전은 3단계에서 한다.
   ============================================================ */

import type { IGame, IRenderer, SpectateSignal, SpectateTarget } from "@arcade/shared";
import { aimConfig as C } from "./config";
import { INITIAL, comboGauge, isHit, isOver, step, type AimState } from "./rules";
import { targetAt } from "./targetPath";

const BACKDROP = "#15171d";
const GRID = "#1e2129";
const TARGET = "#e63946";
const TARGET_HELD = "#90be6d"; // 붙들고 있는 동안
const AIM = "#e8eef2";
const DIM = "#8b95a3";

export class AimGame implements IGame {
  private seed = 0;
  private worldTick = 0;
  private state: AimState = INITIAL;
  /** 조준점(게임 좌표). 판 한가운데에서 시작한다 — 표적도 거기서 출발하므로
   *  첫 순간부터 겨누고 있는 셈이고, 시작하자마자 놓친 상태로 서 있지 않는다. */
  private aimX = C.screenWidth / 2;
  private aimY = C.screenHeight / 2;

  init(seed: number): void {
    this.seed = seed;
    this.worldTick = 0;
    this.state = INITIAL;
    this.aimX = C.screenWidth / 2;
    this.aimY = C.screenHeight / 2;
  }

  /** ⚠️ input을 안 받는다. 이 게임에서 방향키는 아무 뜻이 없고, 조준은 aim으로만 들어온다.
   *  여기서 하는 일은 시계를 읽고 이번 tick의 적중을 한 번 세는 것뿐이다. */
  update(tick: number): void {
    this.worldTick = tick;
    // 끝난 판에서는 더 세지 않는다 — 시간이 다 된 뒤의 한 프레임이 점수를 더 올리면
    // 결과 화면과 순위 기록이 어긋난다(숫자 야구와 같은 이유).
    if (isOver(tick)) return;
    this.state = step(this.state, isHit(this.aimX, this.aimY, targetAt(this.seed, tick)));
  }

  /** 조준점이 움직였다. 판 기준 0~1이 게임 좌표로 바뀌는 곳은 여기뿐이다.
   *  ⚠️ 고정 스텝 밖에서 온다. 여기서는 자리만 적어 두고, 그 자리가 점수가 되는 건
   *     다음 update다 — 한 tick에 여러 번 움직여도 점수는 한 번만 오른다. */
  aim(nx: number, ny: number): void {
    this.aimX = nx * C.screenWidth;
    this.aimY = ny * C.screenHeight;
  }

  render(r: IRenderer): void {
    this.drawField(r);
    const target = targetAt(this.seed, this.worldTick);
    const held = this.state.missTicks === 0;
    this.drawTarget(r, target, held);
    this.drawAim(r, this.aimX, this.aimY, held);
  }

  /** 남의 화면. **a·b는 그 사람의 조준점**이고 표적은 공통 월드라 여기서 다시 구한다
   *  — 그래서 남의 화면에도 같은 표적이 같은 자리에 있고, 다른 것은 조준점뿐이다.
   *  ⚠️ getPosition이 싣는 뜻과 여기서 읽는 뜻은 한 쌍이다. 한쪽만 고치면 안 된다. */
  renderSpectator(r: IRenderer, target: SpectateTarget): void {
    this.drawField(r);
    const spot = targetAt(this.seed, this.worldTick);
    this.drawTarget(r, spot, false);
    this.drawAim(r, target.a, target.b, isHit(target.a, target.b, spot));
    r.text(target.label, C.screenWidth / 2, 44, DIM, 22, "center");
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

  private drawTarget(r: IRenderer, spot: { x: number; y: number; radius: number }, held: boolean): void {
    r.circle(spot.x, spot.y, spot.radius, held ? TARGET_HELD : TARGET);
  }

  private drawAim(r: IRenderer, x: number, y: number, held: boolean): void {
    const color = held ? TARGET_HELD : AIM;
    const arm = 14;
    r.line(x - arm, y, x + arm, y, color, 2);
    r.line(x, y - arm, x, y + arm, color, 2);
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

  getScore(): number {
    return this.state.score;
  }

  /** 배수가 얼마나 차올랐는가(0~1). 남은 시간이 아니라 **집중**을 보여 준다 —
   *  시간은 어차피 모두에게 같고, 이 판에서 사람이 지키려 애쓰는 건 배수다. */
  getGauge(): number {
    return comboGauge(this.state);
  }
}
