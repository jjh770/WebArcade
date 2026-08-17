/* 에임 추적의 규칙 — 표적 경로(targetPath)와 점수(rules).

   판정이 순수 함수라 브라우저 없이 전부 시험할 수 있다. 여기서 잡는 건 이 게임이
   서 있는 약속들이다: 같은 시드면 같은 표적, 표적은 판 안에 머문다, 붙들면 배수가
   오르고 놓치면 무너진다, 그리고 **놓친 유예 동안 점수는 안 오른다.** */
import { describe, expect, it } from "vitest";
import type { IRenderer } from "@arcade/shared";
import { isSoundId } from "../packages/app/src/audio";
import { aimConfig as C } from "../packages/games/aim/src/config";
import { legAt, legTicks, radiusAt, targetAt } from "../packages/games/aim/src/targetPath";
import { INITIAL, comboGauge, comboOf, isHit, isOver, step } from "../packages/games/aim/src/rules";
import { AimGame } from "../packages/games/aim/src/AimGame";

/** hit을 n번 먹인다. */
function hold(state = INITIAL, ticks: number, hit = true) {
  let s = state;
  for (let i = 0; i < ticks; i++) s = step(s, hit);
  return s;
}

describe("표적 경로", () => {
  it("같은 시드는 같은 표적을 낸다", () => {
    for (const tick of [0, 37, 500, 1799, C.timeLimitTicks - 1]) {
      expect(targetAt(4242, tick)).toEqual(targetAt(4242, tick));
    }
  });

  it("시드가 다르면 경로가 갈린다", () => {
    const a = targetAt(1, 600);
    const b = targetAt(2, 600);
    expect(a.x === b.x && a.y === b.y).toBe(false);
  });

  it("어느 tick을 먼저 묻든 답이 같다 — 훑는 순서에 기대지 않는다", () => {
    const forward = [0, 100, 900, 2000].map((t) => targetAt(77, t));
    const backward = [2000, 900, 100, 0].map((t) => targetAt(77, t)).reverse();
    expect(forward).toEqual(backward);
  });

  it("표적 중심이 판 안(여백 안쪽)에 머문다", () => {
    for (let tick = 0; tick <= C.timeLimitTicks; tick += 7) {
      const { x, y } = targetAt(9001, tick);
      expect(x).toBeGreaterThanOrEqual(C.margin - 1e-6);
      expect(x).toBeLessThanOrEqual(C.screenWidth - C.margin + 1e-6);
      expect(y).toBeGreaterThanOrEqual(C.margin - 1e-6);
      expect(y).toBeLessThanOrEqual(C.screenHeight - C.margin + 1e-6);
    }
  });

  it("판 한가운데에서 출발한다 — 시작하자마자 놓친 상태로 서 있지 않는다", () => {
    const first = targetAt(5, 0);
    expect(first.x).toBeCloseTo(C.screenWidth / 2, 6);
    expect(first.y).toBeCloseTo(C.screenHeight / 2, 6);
  });

  it("구간마다 최소 거리만큼은 옮겨 간다 — 공짜 구간이 없다", () => {
    for (let index = 0; index < 40; index++) {
      const leg = legAt(31337, startOf(index));
      const moved = Math.hypot(leg.toX - leg.fromX, leg.toY - leg.fromY);
      // 방향을 골라 쓰므로 뽑은 거리가 그대로 지켜진다(접어 넣던 시절엔 26px 구간이 나왔다).
      expect(moved).toBeGreaterThanOrEqual(C.minTravel - 1e-6);
    }
  });

  it("시간이 갈수록 표적이 작아지고 구간이 짧아진다", () => {
    expect(radiusAt(0)).toBeCloseTo(C.startRadius, 6);
    expect(radiusAt(C.timeLimitTicks)).toBeCloseTo(C.endRadius, 6);
    expect(legTicks(0)).toBe(C.startLegTicks);
    expect(legTicks(C.rampLegs)).toBe(C.endLegTicks);
    expect(legTicks(999)).toBe(C.endLegTicks); // 하한 아래로는 안 내려간다
  });

  it("제한시간을 넘긴 tick은 마지막 순간으로 친다 — 표적이 사라지거나 튀지 않는다", () => {
    expect(targetAt(8, C.timeLimitTicks + 500)).toEqual(targetAt(8, C.timeLimitTicks));
  });
});

/** index번째 구간이 시작하는 tick. 구간 길이는 시드와 무관하므로 더하기만 하면 된다. */
function startOf(index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += legTicks(i);
  return at;
}

describe("적중 판정", () => {
  const target = { x: 400, y: 400, radius: 40 };

  it("표적 안이면 맞고 밖이면 빗나간다", () => {
    expect(isHit(400, 400, target)).toBe(true);
    expect(isHit(430, 400, target)).toBe(true);
    expect(isHit(441, 400, target)).toBe(false);
  });

  it("테두리에 정확히 닿은 것은 맞은 것으로 친다 — 보이는 원과 맞는 원이 같아야 한다", () => {
    expect(isHit(440, 400, target)).toBe(true);
  });
});

describe("점수와 배수", () => {
  it("첫 tick은 1점 — 배수는 붙들고 나서 오른다", () => {
    expect(step(INITIAL, true).score).toBe(1);
    expect(comboOf(INITIAL)).toBe(1);
  });

  it("붙들고 있으면 한 단계씩 오르고 상한에서 멈춘다", () => {
    expect(comboOf(hold(INITIAL, C.comboStepTicks))).toBe(2);
    expect(comboOf(hold(INITIAL, C.comboStepTicks * 2))).toBe(3);
    // 아무리 오래 붙들어도 상한을 넘지 않는다.
    expect(comboOf(hold(INITIAL, C.comboStepTicks * 20))).toBe(C.maxCombo);
    expect(comboGauge(hold(INITIAL, C.comboStepTicks * 20))).toBe(1);
  });

  it("놓친 동안은 점수가 안 오른다 — 유예는 배수를 지킬 뿐이다", () => {
    const held = hold(INITIAL, 90);
    const missed = hold(held, C.comboGraceTicks, false);
    expect(missed.score).toBe(held.score);
    expect(comboOf(missed)).toBe(comboOf(held)); // 배수는 그대로
  });

  it("유예 안에 다시 잡으면 배수가 이어지고, 넘기면 무너진다", () => {
    const held = hold(INITIAL, C.comboStepTicks * 3); // 4배
    expect(comboOf(held)).toBe(C.maxCombo);

    const recovered = step(hold(held, C.comboGraceTicks, false), true);
    expect(recovered.score).toBe(held.score + C.maxCombo);

    const broken = hold(held, C.comboGraceTicks + 1, false);
    expect(comboOf(broken)).toBe(1);
  });

  it("오래 붙든 쪽이 같은 적중 시간에도 더 번다 — 지속력이 기록이 된다", () => {
    const steady = hold(INITIAL, 240); // 4초 내리 붙듦

    let choppy = INITIAL; // 같은 4초를 잡았다 놓쳤다 반복
    for (let i = 0; i < 4; i++) {
      choppy = hold(choppy, 60);
      choppy = hold(choppy, C.comboGraceTicks + 1, false);
    }

    expect(steady.hitTicks).toBe(choppy.hitTicks);
    expect(steady.score).toBeGreaterThan(choppy.score);
  });
});

describe("판의 끝", () => {
  it("시간이 유일한 끝이다", () => {
    expect(isOver(C.timeLimitTicks - 1)).toBe(false);
    expect(isOver(C.timeLimitTicks)).toBe(true);
  });

  it("끝난 뒤의 tick은 점수를 더 올리지 않는다", () => {
    const game = new AimGame();
    game.init(1234);
    // 판 한가운데를 겨눈 채 시간이 다 갈 때까지 돌린다.
    game.aim(0.5, 0.5);
    // 제한시간 **그 tick까지** 돌린다 — 판은 tick이 상한에 닿는 순간 끝난다.
    for (let tick = 0; tick <= C.timeLimitTicks; tick++) game.update(tick);
    const final = game.getScore();
    expect(final).toBeGreaterThan(0);
    expect(game.isPlayerDead()).toBe(true);

    for (let tick = C.timeLimitTicks; tick < C.timeLimitTicks + 120; tick++) game.update(tick);
    expect(game.getScore()).toBe(final);
  });

  it("관전 신호는 조준점이다 — 겨눈 자리가 그대로 실린다", () => {
    const game = new AimGame();
    game.init(1);
    game.aim(0.25, 0.75);
    expect(game.getPosition()).toEqual({ a: C.screenWidth * 0.25, b: C.screenHeight * 0.75 });
  });
});

/* ---- 화면과 소리 --------------------------------------------------------- */

/** 판 위에서 읽어 내는 것: 십자 조준점의 색과 남은 시간 막대의 길이.
 *  색 값 자체는 게임 내부 상수라 밖에서 모른다 — **세 상태가 서로 다른 색인가**만 본다. */
class ScreenProbe implements IRenderer {
  readonly width = C.screenWidth;
  readonly height = C.screenHeight;
  /** 격자가 아닌 선의 색 = 십자 조준점. */
  crosshair: string | null = null;
  /** 남은 시간 막대의 폭(막대는 높이 7인 rect 둘 중 나중 것). */
  timeBar = -1;
  private bars = 0;

  reset(): this {
    this.crosshair = null;
    this.timeBar = -1;
    this.bars = 0;
    return this;
  }
  clear(): void {}
  circle(): void {}
  text(): void {}
  rect(_x: number, _y: number, w: number, h: number): void {
    if (h !== 7) return;
    this.bars++;
    if (this.bars === 2) this.timeBar = w; // 첫째는 바탕, 둘째가 남은 시간
  }
  line(_x1: number, _y1: number, _x2: number, _y2: number, color: string, width?: number): void {
    if (width === 2) this.crosshair = color; // 격자는 굵기 1이다
  }
}

/** 표적을 정확히 겨눈 채 ticks만큼 굴린다. 놓치게 하려면 hold=false. */
function play(game: AimGame, seed: number, from: number, ticks: number, hold: boolean): number {
  let tick = from;
  for (let i = 0; i < ticks; i++, tick++) {
    const t = targetAt(seed, tick);
    // 놓칠 때는 판 반대쪽 구석 — 표적이 어디 있든 확실히 밖이다.
    if (hold) game.aim(t.x / C.screenWidth, t.y / C.screenHeight);
    else game.aim(t.x > C.screenWidth / 2 ? 0 : 1, t.y > C.screenHeight / 2 ? 0 : 1);
    game.update(tick);
  }
  return tick;
}

describe("소리", () => {
  it("배수가 오르는 순간에만 lock이 난다 — 매 tick 나지 않는다", () => {
    const game = new AimGame();
    game.init(3);
    let locks = 0;
    let tick = 0;
    for (let i = 0; i < C.comboStepTicks * 3 + 10; i++, tick++) {
      const t = targetAt(3, tick);
      game.aim(t.x / C.screenWidth, t.y / C.screenHeight);
      game.update(tick);
      if ((game.consumeSounds() ?? []).includes("lock")) locks++;
    }
    // 1배에서 시작해 상한까지 = 오르는 순간은 maxCombo - 1번뿐이다.
    expect(locks).toBe(C.maxCombo - 1);
  });

  it("유예 안에서 잠깐 놓친 것에는 소리가 없고, 넘겨야 slip이 난다", () => {
    const game = new AimGame();
    game.init(3);
    let tick = play(game, 3, 0, C.comboStepTicks + 5, true); // 배수 2까지 올린다
    game.consumeSounds();

    tick = play(game, 3, tick, C.comboGraceTicks, false); // 유예 안까지만 놓친다
    expect(game.consumeSounds()).toBeNull();

    play(game, 3, tick, 1, false); // 한 tick 더 — 유예를 넘긴다
    expect(game.consumeSounds()).toEqual(["slip"]);
  });

  it("소리를 가져가든 안 가져가든 점수가 같다 — 소리는 판을 바꾸지 않는다", () => {
    const score = (drain: boolean) => {
      const game = new AimGame();
      game.init(808);
      for (let tick = 0; tick <= 900; tick++) {
        const t = targetAt(808, tick);
        // 절반은 겨누고 절반은 놓친다 — 배수가 올랐다 무너지길 반복하게.
        if (tick % 200 < 150) game.aim(t.x / C.screenWidth, t.y / C.screenHeight);
        else game.aim(0, 0);
        game.update(tick);
        if (drain) game.consumeSounds();
      }
      return game.getScore();
    };
    expect(score(true)).toBe(score(false));
  });

  it("끝난 판에서는 소리가 안 난다", () => {
    const game = new AimGame();
    game.init(3);
    play(game, 3, 0, C.timeLimitTicks + 1, true);
    game.consumeSounds();
    play(game, 3, C.timeLimitTicks + 1, 120, true);
    expect(game.consumeSounds()).toBeNull();
  });

  it("게임이 내는 슬러그는 앱의 소리 표에 있다 — 이름이 어긋나면 조용히 안 난다", () => {
    for (const slug of ["lock", "slip"]) expect(isSoundId(slug)).toBe(true);
  });
});

describe("화면이 말하는 것", () => {
  it("붙듦 · 유예 · 놓침이 서로 다른 색으로 나온다", () => {
    const game = new AimGame();
    const probe = new ScreenProbe();
    game.init(3);

    let tick = play(game, 3, 0, C.comboStepTicks + 5, true);
    game.render(probe.reset());
    const holding = probe.crosshair;

    tick = play(game, 3, tick, 2, false); // 방금 놓쳤다 — 배수는 아직 살아 있다
    game.render(probe.reset());
    const grace = probe.crosshair;

    play(game, 3, tick, C.comboGraceTicks + 2, false); // 유예를 넘겼다
    game.render(probe.reset());
    const lost = probe.crosshair;

    expect(holding).toBeTruthy();
    expect(new Set([holding, grace, lost]).size).toBe(3);
  });

  it("남은 시간 막대가 줄어든다 — HUD 게이지는 시간이 아니라 집중을 보여 주므로", () => {
    const game = new AimGame();
    const probe = new ScreenProbe();
    game.init(3);

    game.render(probe.reset());
    const atStart = probe.timeBar;

    play(game, 3, 0, C.timeLimitTicks / 2, true);
    game.render(probe.reset());
    const half = probe.timeBar;

    expect(atStart).toBeCloseTo(C.screenWidth, 6);
    expect(half).toBeCloseTo(C.screenWidth / 2, 0);
  });

  it("관전 화면도 같은 표적을 그리고 남의 조준점을 얹는다", () => {
    const game = new AimGame();
    const probe = new ScreenProbe();
    game.init(3);
    play(game, 3, 0, 100, true);

    const spot = targetAt(3, 100);
    game.renderSpectator(probe.reset(), { id: "x", a: spot.x, b: spot.y, label: "남" });
    const onTarget = probe.crosshair;
    game.renderSpectator(probe.reset(), { id: "x", a: 0, b: 0, label: "남" });
    expect(onTarget).not.toBe(probe.crosshair); // 남이 맞았는지 아닌지가 보인다
  });
});
