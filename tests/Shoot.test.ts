/* 에임 사격의 규칙 — 출현표(targets)와 한 발의 판정(rules).

   이 게임이 서 있는 약속들을 붙든다. 그중 하나는 **다른 다섯 게임에는 없던 것**이다:
   출현표가 내 사격에 조금도 좌우되지 않아야 한다. 그게 깨지면 잘 쏘는 사람과 못 쏘는
   사람이 서로 다른 판을 보게 되고, 순위표와 관전이 동시에 무너진다. */
import { describe, expect, it } from "vitest";
import type { IRenderer } from "@arcade/shared";
import { isSoundId } from "../packages/app/src/audio";
import { shootConfig as C } from "../packages/games/shoot/src/config";
import {
  bornTickFor, intervalFor, lifeFor, liveTargets, pointFor, targetAt, totalTargets,
} from "../packages/games/shoot/src/targets";
import {
  INITIAL, accuracyOf, covers, isOver, pointsFor, shoot, targetUnder,
} from "../packages/games/shoot/src/rules";
import { ShootGame } from "../packages/games/shoot/src/ShootGame";

describe("출현표", () => {
  it("같은 시드는 같은 표적을 낸다", () => {
    for (const index of [0, 1, 9, 30]) {
      expect(targetAt(555, index)).toEqual(targetAt(555, index));
    }
  });

  it("시드가 다르면 자리가 갈린다", () => {
    const a = pointFor(1, 5);
    const b = pointFor(2, 5);
    expect(a.x === b.x && a.y === b.y).toBe(false);
  });

  it("표적 중심이 판 안(여백 안쪽)에 머문다", () => {
    for (let index = 0; index < 60; index++) {
      const { x, y } = pointFor(31337, index);
      expect(x).toBeGreaterThanOrEqual(C.margin);
      expect(x).toBeLessThanOrEqual(C.screenWidth - C.margin);
      expect(y).toBeGreaterThanOrEqual(C.margin);
      expect(y).toBeLessThanOrEqual(C.screenHeight - C.margin);
    }
  });

  it("대개 직전 표적에서 멀리 떨어져 뜬다 — 미세 조정이 아니라 손목을 튕기게", () => {
    let far = 0;
    const N = 60;
    for (let index = 1; index < N; index++) {
      const now = pointFor(4242, index);
      const before = pointFor(4242, index - 1);
      if (Math.hypot(now.x - before.x, now.y - before.y) >= C.minGap) far++;
    }
    // 후보를 세 번만 뽑아 보므로 100%는 아니다. 그래도 대부분이어야 한다.
    expect(far / (N - 1)).toBeGreaterThan(0.85);
  });

  it("뒤로 갈수록 자주 뜨고 빨리 진다", () => {
    expect(intervalFor(0)).toBe(C.startIntervalTicks);
    expect(intervalFor(C.rampTargets)).toBe(C.endIntervalTicks);
    expect(intervalFor(9999)).toBe(C.endIntervalTicks); // 끝값 아래로는 안 간다
    expect(lifeFor(0)).toBe(C.startLifeTicks);
    expect(lifeFor(C.rampTargets)).toBe(C.endLifeTicks);
  });

  it("초반엔 하나씩, 후반엔 겹쳐 뜬다 — 난이도가 오르는 방식이 이것이다", () => {
    // ⚠️ 한 tick만 집으면 안 된다. 후반이라도 표적이 하나뿐인 순간은 늘 있어서,
    //    찍는 자리에 따라 답이 흔들린다. 구간의 **최대**로 본다.
    const busiest = (from: number, to: number) => {
      let most = 0;
      for (let tick = from; tick < to; tick++) most = Math.max(most, liveTargets(7, tick).length);
      return most;
    };
    expect(busiest(0, 400)).toBe(1);
    expect(busiest(C.timeLimitTicks - 400, C.timeLimitTicks)).toBeGreaterThanOrEqual(2);
  });

  it("떠 있는 구간에만 목록에 든다", () => {
    const t = targetAt(7, 3);
    expect(liveTargets(7, t.bornTick - 1).some((x) => x.index === 3)).toBe(false);
    expect(liveTargets(7, t.bornTick).some((x) => x.index === 3)).toBe(true);
    expect(liveTargets(7, t.bornTick + t.life - 1).some((x) => x.index === 3)).toBe(true);
    expect(liveTargets(7, t.bornTick + t.life).some((x) => x.index === 3)).toBe(false);
  });

  it("한 판에 서른 개는 뜬다 — 30초가 빈 화면으로 흐르지 않는다", () => {
    expect(totalTargets()).toBeGreaterThan(30);
    expect(bornTickFor(totalTargets() - 1)).toBeLessThan(C.timeLimitTicks);
  });
});

describe("한 발", () => {
  const target = targetAt(11, 0);

  it("표적 안이면 맞고 밖이면 헛방이다", () => {
    expect(covers(target, target.x, target.y)).toBe(true);
    expect(covers(target, target.x + C.radius, target.y)).toBe(true); // 경계 포함
    expect(covers(target, target.x + C.radius + 1, target.y)).toBe(false);
  });

  it("겹친 표적은 중심이 가까운 하나만 맞는다 — 한 발은 한 표적이다", () => {
    const a = { index: 0, x: 400, y: 400, bornTick: 0, life: 100 };
    const b = { index: 1, x: 400 + C.radius, y: 400, bornTick: 0, life: 100 };
    expect(targetUnder([a, b], 400 + C.radius - 2, 400)?.index).toBe(1);
    expect(targetUnder([a, b], 402, 400)?.index).toBe(0);
  });

  it("빨리 맞힐수록 높다", () => {
    const fresh = pointsFor(target, target.bornTick);
    const stale = pointsFor(target, target.bornTick + target.life);
    expect(fresh).toBe(C.hitPoints + C.speedBonus);
    expect(stale).toBe(C.hitPoints);
    expect(pointsFor(target, target.bornTick + target.life / 2)).toBeLessThan(fresh);
  });

  it("헛방은 깎인다 — 이게 없으면 연타가 최적이 된다", () => {
    const after = shoot({ score: 500, shots: 1, hits: 1 }, [], 10, 10, 0);
    expect(after.hit).toBeNull();
    expect(after.state.score).toBe(500 - C.missPenalty);
    expect(after.state.shots).toBe(2);
    expect(after.state.hits).toBe(1);
  });

  it("점수는 0 아래로 안 내려간다", () => {
    const after = shoot(INITIAL, [], 10, 10, 0);
    expect(after.state.score).toBe(0);
    expect(after.gained).toBe(0); // 실제로 깎인 만큼만 보고한다
  });

  it("명중률은 한 발도 안 쐈을 때 1이다 — 시작하자마자 빨갛게 울지 않는다", () => {
    expect(accuracyOf(INITIAL)).toBe(1);
    expect(accuracyOf({ score: 0, shots: 4, hits: 3 })).toBe(0.75);
  });
});

describe("판 전체", () => {
  /** 표적 한가운데를 delay tick 늦게 쏘는 판. 놓치면 그냥 지나간다. */
  function play(seed: number, delay: number, sprayPerSecond = 0): ShootGame {
    const game = new ShootGame();
    game.init(seed);
    const shotAt = new Set<number>();
    for (let tick = 0; tick <= C.timeLimitTicks; tick++) {
      game.update(tick);
      for (const t of liveTargets(seed, tick)) {
        if (shotAt.has(t.index) || tick < t.bornTick + delay) continue;
        if (tick >= t.bornTick + t.life) continue;
        shotAt.add(t.index);
        game.aim(t.x / C.screenWidth, t.y / C.screenHeight);
        game.fire(t.x / C.screenWidth, t.y / C.screenHeight);
      }
      // 빈 곳에 난사하는 흉내(연타가 이득인지 확인용).
      if (sprayPerSecond > 0 && tick % Math.round(60 / sprayPerSecond) === 0) {
        game.fire(0.02, 0.98);
      }
    }
    return game;
  }

  it("맞힌 표적은 사라져 다시 못 맞힌다 — 한 표적에 두 발이 안 든다", () => {
    const game = new ShootGame();
    game.init(9);
    const t = targetAt(9, 0);
    for (let tick = 0; tick <= t.bornTick; tick++) game.update(tick);
    game.fire(t.x / C.screenWidth, t.y / C.screenHeight);
    const afterFirst = game.getScore();
    game.fire(t.x / C.screenWidth, t.y / C.screenHeight); // 같은 자리를 또
    expect(game.getScore()).toBe(Math.max(0, afterFirst - C.missPenalty)); // 헛방이다
  });

  it("빨리 쏘는 판이 늦게 쏘는 판보다 높다", () => {
    expect(play(9, 0).getScore()).toBeGreaterThan(play(9, 40).getScore());
  });

  it("난사는 손해다 — 헛방 감점이 실제로 일한다", () => {
    const clean = play(9, 0);
    const spray = play(9, 0, 8); // 같은 사격에 초당 여덟 번 헛방을 더한다
    expect(spray.getScore()).toBeLessThan(clean.getScore());
    expect(spray.getGauge()).toBeLessThan(clean.getGauge()); // 명중률도 떨어진다
  });

  it("끝난 뒤의 한 발은 점수를 바꾸지 않는다", () => {
    const game = play(9, 0);
    expect(game.isPlayerDead()).toBe(true);
    const final = game.getScore();
    game.fire(0.5, 0.5);
    expect(game.getScore()).toBe(final);
  });

  it("시간이 유일한 끝이다", () => {
    expect(isOver(C.timeLimitTicks - 1)).toBe(false);
    expect(isOver(C.timeLimitTicks)).toBe(true);
  });

  it("총성은 매 발 나고 명중 확인음만 그 위에 얹힌다", () => {
    const game = new ShootGame();
    game.init(9);
    const t = targetAt(9, 0);
    for (let tick = 0; tick <= t.bornTick; tick++) game.update(tick);

    game.fire(t.x / C.screenWidth, t.y / C.screenHeight);
    expect([...(game.consumeSounds() ?? [])].sort()).toEqual(["pop", "shot"]);

    // 헛방에는 따로 소리를 두지 않는다 — 총성만 나고 아무 반응이 없는 것이 곧 빗나감이다.
    game.fire(0.02, 0.98);
    expect(game.consumeSounds()).toEqual(["shot"]);
    expect(game.consumeSounds()).toBeNull(); // 아무 일 없으면 null이다

    for (const slug of ["shot", "pop"]) expect(isSoundId(slug)).toBe(true);
  });

  it("소리를 가져가든 안 가져가든 점수가 같다 — 소리는 판을 바꾸지 않는다", () => {
    const score = (drain: boolean) => {
      const game = new ShootGame();
      game.init(21);
      const done = new Set<number>();
      for (let tick = 0; tick <= 900; tick++) {
        game.update(tick);
        for (const t of liveTargets(21, tick)) {
          if (done.has(t.index)) continue;
          done.add(t.index);
          game.fire(t.x / C.screenWidth, t.y / C.screenHeight);
        }
        if (tick % 100 === 0) game.fire(0.02, 0.98); // 헛방도 섞는다
        if (drain) game.consumeSounds();
      }
      return game.getScore();
    };
    expect(score(true)).toBe(score(false));
  });

  it("쏜 사실이 남들 화면용으로 한 번만 실려 나간다 — 연출 전용이다", () => {
    const game = new ShootGame();
    game.init(9);
    const t = targetAt(9, 0);
    for (let tick = 0; tick <= t.bornTick; tick++) game.update(tick);

    expect(game.consumePeerEvent()).toBeNull();
    game.fire(t.x / C.screenWidth, t.y / C.screenHeight);
    expect(game.consumePeerEvent()).toBe("h");
    expect(game.consumePeerEvent()).toBeNull(); // 한 번만
    game.fire(0.02, 0.98);
    expect(game.consumePeerEvent()).toBe("m");
  });

  it("한 판을 굴려도 출현표가 변하지 않는다 — 월드는 게임 밖에 있다", () => {
    const snapshot = () => {
      const out: string[] = [];
      for (let tick = 0; tick <= C.timeLimitTicks; tick += 30) {
        out.push(liveTargets(9, tick).map((t) => `${t.index}@${Math.round(t.x)},${Math.round(t.y)}`).join("|"));
      }
      return out;
    };
    const before = snapshot();
    const perfect = play(9, 0); // 다 맞히는 판
    const lazy = play(9, 999); // 한 발도 못 맞히는 판
    expect(snapshot()).toEqual(before);

    // 그리고 두 판의 결과는 실제로 갈렸다 — 위 비교가 빈 비교가 아니라는 뜻이다.
    expect(perfect.getScore()).toBeGreaterThan(0);
    expect(lazy.getScore()).toBe(0);
  });

  it("남이 쏜 신호는 점수도 표적도 바꾸지 않는다 — 판정이 아니다", () => {
    const game = new ShootGame();
    game.init(9);
    for (let tick = 0; tick <= 200; tick++) game.update(tick);
    const before = { score: game.getScore(), gauge: game.getGauge() };
    game.applyPeerEvent("남", "h");
    game.applyPeerEvent("남", "m");
    game.applyPeerEvent("남", "모르는-것");
    expect({ score: game.getScore(), gauge: game.getGauge() }).toEqual(before);
  });
});

/* ---- 화면 --------------------------------------------------------------- */

/** 판 위에서 읽어 내는 것. 색 값 자체는 게임 내부 상수라 밖에서 모른다 —
 *  **무엇이 몇 개 그려졌고 상태에 따라 달라지는가**만 본다. */
class ScreenProbe implements IRenderer {
  readonly width = C.screenWidth;
  readonly height = C.screenHeight;
  circles: { x: number; y: number; r: number; color: string }[] = [];
  texts: { text: string; x: number; y: number; color: string }[] = [];
  /** 십자 조준점의 팔 길이(굵기 2인 선). 반동으로 늘어난다. */
  crossArm = 0;

  reset(): this {
    this.circles = [];
    this.texts = [];
    this.crossArm = 0;
    return this;
  }
  clear(): void {}
  rect(): void {}
  circle(x: number, y: number, r: number, color: string): void {
    this.circles.push({ x, y, r, color });
  }
  text(text: string, x: number, y: number, color: string): void {
    this.texts.push({ text, x, y, color });
  }
  line(x1: number, _y1: number, x2: number, _y2: number, _color: string, width?: number): void {
    if (width === 2) this.crossArm = Math.max(this.crossArm, Math.abs(x2 - x1));
  }
}

describe("화면이 말하는 것", () => {
  /** tick까지 굴린 게임. */
  function at(seed: number, tick: number): ShootGame {
    const game = new ShootGame();
    game.init(seed);
    for (let t = 0; t <= tick; t++) game.update(t);
    return game;
  }

  it("수명 고리가 조여든다 — 고리가 클수록 점수가 높다는 규칙이 눈에 보인다", () => {
    const t = targetAt(9, 0);
    const probe = new ScreenProbe();
    // 표적 자리에 그려진 원 중 가장 큰 것 = 수명 고리.
    const ringAt = (tick: number) => {
      at(9, tick).render(probe.reset());
      return Math.max(...probe.circles.filter((c) => Math.abs(c.x - t.x) < 1).map((c) => c.r));
    };
    const born = ringAt(t.bornTick);
    const late = ringAt(t.bornTick + t.life - 1);
    expect(born).toBeCloseTo(C.radius * 2.8, 0); // 표적보다 한참 크게 시작해
    expect(late).toBeLessThan(C.radius * 1.05); // 표적 크기까지 조여든다
  });

  it("쏘면 조준점이 벌어졌다 돌아온다 — 눌린 게 눈에도 보인다", () => {
    const game = at(9, 300);
    const probe = new ScreenProbe();
    game.render(probe.reset());
    const resting = probe.crossArm;

    game.fire(0.5, 0.5);
    game.render(probe.reset());
    const kicked = probe.crossArm;
    expect(kicked).toBeGreaterThan(resting);

    for (let tick = 301; tick <= 320; tick++) game.update(tick);
    game.render(probe.reset());
    expect(probe.crossArm).toBe(resting); // 제자리로 돌아온다
  });

  it("맞힘과 헛방이 그 자리에 숫자로 뜨고, 잠시 뒤 사라진다", () => {
    const t = targetAt(9, 0);
    const game = at(9, t.bornTick);
    const probe = new ScreenProbe();

    game.fire(t.x / C.screenWidth, t.y / C.screenHeight);
    game.render(probe.reset());
    const hit = probe.texts.find((x) => x.text.startsWith("+"));
    expect(hit).toBeTruthy();
    expect(hit!.x).toBeCloseTo(t.x, 0);

    game.fire(0.02, 0.98);
    game.render(probe.reset());
    expect(probe.texts.some((x) => x.text === `-${C.missPenalty}`)).toBe(true);

    for (let tick = t.bornTick; tick <= t.bornTick + 60; tick++) game.update(tick);
    game.render(probe.reset());
    expect(probe.texts).toEqual([]); // 낡은 것은 버린다
  });

  it("점수가 0이면 헛방에 '-30'을 띄우지 않는다 — 화면이 규칙에 대해 거짓말하지 않는다", () => {
    const game = at(9, 300);
    const probe = new ScreenProbe();
    expect(game.getScore()).toBe(0);
    game.fire(0.02, 0.98);
    game.render(probe.reset());
    expect(probe.texts.map((x) => x.text)).toContain("빗나감");
  });

  it("맞힌 표적은 내 화면에서 사라지지만 관전 화면에는 남는다 — 남의 사정은 모른다", () => {
    const t = targetAt(9, 0);
    const game = at(9, t.bornTick);
    const probe = new ScreenProbe();

    game.fire(t.x / C.screenWidth, t.y / C.screenHeight);
    game.render(probe.reset());
    expect(probe.circles.some((c) => Math.abs(c.x - t.x) < 1)).toBe(false);

    game.renderSpectator(probe.reset(), { id: "남", a: 10, b: 10, label: "남" });
    expect(probe.circles.some((c) => Math.abs(c.x - t.x) < 1)).toBe(true);
  });

  it("남이 쏜 순간에만 관전 화면에 섬광이 뜬다", () => {
    const game = at(9, 300);
    const probe = new ScreenProbe();
    const spectate = () => {
      game.renderSpectator(probe.reset(), { id: "남", a: 400, b: 700, label: "남" });
      return probe.circles.filter((c) => Math.abs(c.x - 400) < 1 && Math.abs(c.y - 700) < 1).length;
    };
    expect(spectate()).toBe(0);
    game.applyPeerEvent("남", "h");
    expect(spectate()).toBe(1);
    for (let tick = 301; tick <= 330; tick++) game.update(tick);
    expect(spectate()).toBe(0); // 잠깐만 뜬다
  });

});
