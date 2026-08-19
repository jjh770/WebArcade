/* 에임 사격의 규칙 — 출현표(targets)와 한 발의 판정(rules).

   이 게임이 서 있는 약속들을 붙든다. 그중 하나는 **다른 다섯 게임에는 없던 것**이다:
   출현표가 내 사격에 조금도 좌우되지 않아야 한다. 그게 깨지면 잘 쏘는 사람과 못 쏘는
   사람이 서로 다른 판을 보게 되고, 순위표와 관전이 동시에 무너진다. */
import { describe, expect, it } from "vitest";
import type { IRenderer } from "@arcade/shared";
import { isSoundId } from "../packages/app/src/audio";
import { shootConfig as C } from "../packages/games/shoot/src/config";
import {
  bornTickFor, intervalAt, lifeAt, liveTargets, phaseAt, pointFor, targetAt, totalTargets,
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

  it("10초마다 한 구간이고, 구간이 넘어갈 때만 빨라진다", () => {
    // 난이도의 축이 표적 번호가 아니라 **시각**이다(2026-08-17 사용자 요청).
    expect(C.phaseIntervals).toHaveLength(6); // 60초 / 10초
    expect(C.phaseLives).toHaveLength(C.phaseIntervals.length);
    expect(C.phaseTicks * C.phaseIntervals.length).toBe(C.timeLimitTicks);

    for (let phase = 0; phase < C.phaseIntervals.length; phase++) {
      const start = phase * C.phaseTicks;
      expect(phaseAt(start)).toBe(phase);
      expect(phaseAt(start + C.phaseTicks - 1)).toBe(phase); // 구간 안에서는 안 바뀐다
      expect(intervalAt(start)).toBe(C.phaseIntervals[phase]);
      expect(lifeAt(start)).toBe(C.phaseLives[phase]);
    }
    expect(phaseAt(C.timeLimitTicks + 9999)).toBe(C.phaseIntervals.length - 1); // 끝을 넘겨도 마지막
  });

  it("10초마다 조금씩 자주 뜨고, 마지막 10초에 폭주한다", () => {
    const gaps = [...C.phaseIntervals];
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeLessThan(gaps[i - 1]!); // 계속 좁아진다
    // 마지막 한 걸음이 앞의 어느 걸음보다도 크다 — 그게 「폭주」다.
    const steps = gaps.slice(1).map((g, i) => gaps[i]! - g);
    expect(steps.at(-1)!).toBeGreaterThan(Math.max(...steps.slice(0, -1)) * 1.5);
  });

  it("초반엔 하나씩, 마지막 10초엔 겹쳐 뜬다", () => {
    // ⚠️ 한 tick만 집으면 안 된다. 후반이라도 표적이 하나뿐인 순간은 늘 있어서,
    //    찍는 자리에 따라 답이 흔들린다. 구간의 **최대**로 본다.
    const busiest = (from: number, to: number) => {
      let most = 0;
      for (let tick = from; tick < to; tick++) most = Math.max(most, liveTargets(7, tick).length);
      return most;
    };
    // 앞의 세 구간은 수명 < 간격이라 하나씩이다.
    expect(busiest(0, C.phaseTicks * 3)).toBe(1);
    // 마지막 10초는 폭주.
    expect(busiest(C.timeLimitTicks - C.phaseTicks, C.timeLimitTicks)).toBeGreaterThanOrEqual(3);
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

describe("반동 — 연출이 아니라 규칙이다", () => {
  /** tick까지 굴린 게임. */
  function at(seed: number, tick: number): ShootGame {
    const game = new ShootGame();
    game.init(seed);
    for (let t = 0; t <= tick; t++) game.update(t);
    return game;
  }
  const N = (x: number) => x / C.screenWidth;

  it("조준점은 마우스에 붙어 있다 — 쏴도 안 움직인다", () => {
    // ⚠️ 이게 이 게임의 첫 번째 약속이다. 한동안 조준점을 밀어 올렸는데(2026-08-17),
    //    그러면 "내 마우스가 곧 조준점"이 깨진다. 움직여야 하는 건 판이다.
    const game = at(9, 300);
    const probe = new ScreenProbe();
    const crossAt = () => {
      game.render(probe.reset());
      return probe.crossSpan; // 십자가 그려진 가로 폭
    };
    game.aim(0.5, 0.5);
    crossAt();
    const restingCenter = probe.crossCenter;

    game.fire(0.5, 0.5);
    game.aim(0.5, 0.5); // 손은 그대로
    crossAt();
    expect(probe.crossCenter).toBeCloseTo(restingCenter, 6); // 조준점은 제자리
    expect(restingCenter).toBeCloseTo(0.5 * C.screenWidth, 6); // 그리고 마우스 자리다
  });

  it("쏘면 판이 아래로 밀려 내려온다 — 시야가 튄 것이다", () => {
    const t = targetAt(9, 0);
    const game = at(9, t.bornTick + 3);
    const probe = new ScreenProbe();
    const drawnY = () => {
      game.render(probe.reset());
      const rim = probe.circles.find((c) => Math.abs(c.r - C.radius) < 0.01);
      return rim ? rim.y : NaN;
    };
    const before = drawnY();
    game.fire(0.02, 0.02); // 표적에서 먼 구석을 쏜다
    const after = drawnY();
    expect(after).toBeGreaterThan(before + C.recoilKick / 2); // 아래(큰 y)로 내려왔다
  });

  it("보이는 표적을 누르면 그 표적이 맞는다 — 판이 흔들려도", () => {
    // ⚠️ **이 게임에서 가장 중요한 불변식이다.** 판을 흔들면서 판정을 그대로 두면
    //    보고 누른 곳이 빗나간다. 여기서는 그리기와 판정이 같은 오프셋을 지나므로,
    //    화면에서 과녁이 그려진 그 자리를 누르면 언제나 맞는다.
    const t = targetAt(9, 0);
    const game = at(9, t.bornTick);
    const probe = new ScreenProbe();

    // 두 발을 구석에 쏴서 시야를 크게 튀게 해 둔다.
    game.fire(0.05, 0.05);
    game.fire(0.05, 0.05);
    const scoreBefore = game.getScore();

    // 지금 화면에서 과녁이 그려진 자리.
    game.render(probe.reset());
    const rim = probe.circles.find((c) => Math.abs(c.r - C.radius) < 0.01)!;
    expect(rim).toBeTruthy();
    // 시야가 실제로 튀어 있어야 이 테스트가 무언가를 본다.
    expect(Math.hypot(rim.x - t.x, rim.y - t.y)).toBeGreaterThan(C.radius);

    // **판 좌표가 아니라 화면 좌표**를 누른다 — 사람이 보고 누르는 방식 그대로.
    game.fire(rim.x / C.screenWidth, rim.y / C.screenHeight);
    expect(game.getScore()).toBeGreaterThan(scoreBefore);

    // 반대로 **판 좌표**(눈에 보이지 않는 자리)를 누르면 빗나간다.
    const other = at(9, t.bornTick);
    other.fire(0.05, 0.05);
    other.fire(0.05, 0.05);
    const base = other.getScore();
    other.fire(N(t.x), t.y / C.screenHeight);
    expect(other.getScore()).toBeLessThanOrEqual(base);
  });

  it("쉬면 제자리로 돌아온다", () => {
    const game = at(9, 300);
    game.aim(0.5, 0.5);
    game.fire(0.5, 0.5);
    // 지수 감쇠라 완전히 0이 되지는 않는다 — 눈에 안 보일 때까지(2.5초) 기다린다.
    for (let tick = 301; tick <= 300 + 150; tick++) game.update(tick);
    const back = game.getPosition();
    expect(back.a).toBeCloseTo(0.5 * C.screenWidth, 0);
    expect(back.b).toBeCloseTo(0.5 * C.screenHeight, 0);
  });

  it("빠르게 이어 쏘면 **남은 것이 겹쳐** 더 밀리고, 상한에서 멈춘다", () => {
    // 세기는 고정이지만 앞의 튐이 다 안 가라앉은 채로 더해진다 — 겹침은 남겨 둔 설계다.
    const game = at(9, 300);
    game.aim(0.5, 0.5);
    let tick = 300;
    const climb: number[] = [];
    for (let shot = 0; shot < 12; shot++) {
      game.fire(0.5, 0.5);
      climb.push(0.5 * C.screenHeight - game.getPosition().b); // 얼마나 올라갔나
      game.update(++tick); // 연사 — 반동이 다 안 풀린다
    }
    expect(climb[0]!).toBeCloseTo(C.recoilKick, 5); // 첫 발은 딱 한 발 몫
    expect(climb[1]!).toBeGreaterThan(climb[0]!); // 둘째부터 겹친다
    // 상한은 금방 닿는다(50 + 남은 것 → 68). 그 뒤로는 아무리 쏴도 더 안 올라간다.
    expect(Math.max(...climb)).toBeLessThanOrEqual(C.recoilMax + 1);
    expect(climb.at(-1)).toBeCloseTo(C.recoilMax, 0);
  });

  it("한 발의 세기는 몇 발째든 같다 — 연사로 세지지 않는다", () => {
    // ⚠️ 한동안 연사할수록 세지게 했다가 걷어냈다(2026-08-17). 후반에 표적이 0.25초마다
    //    뜨는 구간에서 연사가 한 번도 안 끊겨 반동이 상한에 붙박였기 때문이다.
    const game = at(9, 300);
    game.aim(0.5, 0.5);
    let tick = 300;
    const kickOf = () => {
      const before = game.getPosition().b;
      game.fire(0.5, 0.5);
      game.aim(0.5, 0.5);
      return before - game.getPosition().b;
    };
    // ⚠️ 발 사이를 20tick 띄운다. 붙여 쏘면 **쌓인 총량이 상한(160px)에 부딪혀** 도약이
    //    작게 관측되는데, 그건 세기가 준 게 아니라 겹침이 잘린 것이다(바로 아래 테스트).
    //    30tick이면 연사 판정(40tick)은 안 끊기면서 상한에는 안 닿는다.
    const kicks = [kickOf()];
    for (let shot = 0; shot < 6; shot++) {
      for (let k = 0; k < 30; k++) game.update(++tick);
      kicks.push(kickOf());
    }
    for (const kick of kicks) expect(kick).toBeCloseTo(C.recoilKick, 5);

    for (let k = 0; k < C.recoilResetTicks + 5; k++) game.update(++tick);
    expect(kickOf()).toBeCloseTo(C.recoilKick, 5); // 쉬었다 쏴도 같다
  });

  it("아무리 튀어도 표적이 판 밖으로 안 나간다", () => {
    // ⚠️ **여백·표적 크기·반동 상한 셋의 관계다.** 여백이 60이던 시절엔 시야의 여유가
    //    26px뿐이라 한 발(70px)에 아래쪽 표적이 화면 밖으로 통째로 나갔다 — 보이지도
    //    않는 표적이 생기는 건 「보이는 걸 누르면 맞는다」보다 먼저 깨지는 약속이다.
    //    셋 중 하나를 올리면 여기서 걸린다.
    const room = C.margin - C.radius; // 표적 끝과 판 끝 사이의 빈 자리
    expect(C.recoilMax).toBeLessThan(room);
    expect(C.recoilKick).toBeLessThanOrEqual(C.recoilMax);

    // 실제로도 확인한다: 최악의 표적을 최악까지 튄 시야로 옮겨 봐도 판 안이다.
    const worst = [C.margin, C.screenWidth - C.margin];
    for (const x of worst) {
      for (const y of worst) {
        for (const dx of [-C.recoilMax, C.recoilMax]) {
          expect(x + dx - C.radius).toBeGreaterThanOrEqual(0);
          expect(x + dx + C.radius).toBeLessThanOrEqual(C.screenWidth);
        }
        // 세로는 아래로만 튄다(총구가 들리므로).
        expect(y + C.recoilMax + C.radius).toBeLessThanOrEqual(C.screenHeight);
      }
    }
  });

  it("미리보기가 겨누라는 자리를 쏘면 맞는다 — 시야가 튀어 있어도", () => {
    // ⚠️ `demoAim`은 **화면 좌표**를 돌려줘야 한다. 판 좌표를 그대로 주면 시야가 튄 동안
    //    미리보기가 헛방만 쏘고, 배경이 탄흔으로 뒤덮인다(그렇게 만들었다가 고쳤다).
    const t = targetAt(9, 0);
    const game = at(9, t.bornTick);
    game.fire(0.05, 0.05); // 구석을 쏴서 시야를 튀게 해 둔다
    game.fire(0.05, 0.05);
    const base = game.getScore();

    const spot = game.demoAim()!;
    expect(spot).toBeTruthy();
    // 판 좌표와 다르다 = 시야 오프셋이 실제로 반영됐다.
    expect(Math.abs(spot.nx * C.screenWidth - t.x) + Math.abs(spot.ny * C.screenHeight - t.y))
      .toBeGreaterThan(1);

    game.fire(spot.nx, spot.ny);
    expect(game.getScore()).toBeGreaterThan(base);
  });

  it("겨눌 표적이 없으면 미리보기에 null을 준다", () => {
    const game = at(9, 0);
    const t = targetAt(9, 0);
    game.fire(t.x / C.screenWidth, t.y / C.screenHeight); // 하나뿐인 표적을 맞혀 없앤다
    expect(game.demoAim()).toBeNull();
  });

  it("시선을 돌리면 조준점은 가운데 붙박이고 판이 움직인다", () => {
    // 2026-08-18 사용자 요청으로 PC는 FPS 방식이 됐다 — 마우스가 조준점이 아니라 시선을 돌린다.
    const t = targetAt(9, 0);
    const game = at(9, t.bornTick + 3);
    const probe = new ScreenProbe();
    const drawn = () => {
      game.render(probe.reset());
      const rim = probe.circles.find((c) => Math.abs(c.r - C.radius) < 0.01)!;
      return { 표적: rim, 조준점: probe.crossCenter };
    };
    const before = drawn();

    game.look(0.1, 0); // 오른쪽으로 돌린다
    const after = drawn();

    // 조준점은 화면 한가운데에 붙박여 있다.
    expect(after.조준점).toBeCloseTo(C.screenWidth / 2, 6);
    // 판은 반대로 밀린다(오른쪽을 보면 세상은 왼쪽으로).
    expect(after.표적.x).toBeLessThan(before.표적.x - C.screenWidth * 0.05);
  });

  it("시선을 돌리면 시점이 뒤로 물러난다 — 판이 한눈에 더 많이 들어온다", () => {
    // 2026-08-18 사용자: "지금 너무 가까워서 표적을 따라가기가 벅차". 조준점이 화면
    // 한가운데에 못 박혀 있으니 판 구석을 겨누면 판의 절반이 화면 밖으로 나갔다.
    const game = at(9, 300);
    const probe = new ScreenProbe();
    // 사격장 바닥의 가장 바깥 고리 = 판이 얼마나 크게 그려졌나. 표적과 달리 늘 그려진다.
    const 판크기 = () => {
      game.render(probe.reset());
      return Math.max(...probe.circles.map((c) => c.r));
    };
    const 처음 = 판크기();

    game.look(0.001, 0); // 시선을 돌린 순간부터 물러나기 시작한다
    for (let tick = 301; tick <= 360; tick++) game.update(tick);
    expect(판크기() / 처음).toBeCloseTo(C.viewZoom, 3);
  });

  it("물러나도 보이는 표적을 누르면 맞는다 — 배율이 판정까지 지난다", () => {
    // ⚠️ 배율을 그리기에만 태우면 「보이는 걸 누르면 맞는다」가 그 자리에서 깨진다.
    const t = targetAt(9, 0);
    const game = at(9, t.bornTick);
    const probe = new ScreenProbe();
    game.look(0.2, 0.15); // 시선을 돌려 물러나게 한다
    for (let tick = t.bornTick + 1; tick <= t.bornTick + 60; tick++) game.update(tick);
    game.fire(0.02, 0.02); // 표적이 없는 자리 — 반동까지 얹어 둔다
    const base = game.getScore();

    game.render(probe.reset());
    const rim = probe.circles.find((c) => Math.abs(c.r - C.radius * C.viewZoom) < 0.01)!;
    expect(rim).toBeTruthy(); // 물러난 만큼 작게 그려져 있다
    game.fire(rim.x / C.screenWidth, rim.y / C.screenHeight);
    expect(game.getScore()).toBeGreaterThan(base);
  });

  it("손가락이 닿으면 판이 다시 화면에 꼭 맞는다 — 절대 조준은 물러나면 안 된다", () => {
    // 폰은 가리킨 자리가 곧 판의 그 자리다. 물러난 채로 두면 손끝과 판이 어긋난다.
    const game = at(9, 300);
    const probe = new ScreenProbe();
    const 판크기 = () => {
      game.render(probe.reset());
      return Math.max(...probe.circles.map((c) => c.r));
    };
    const 처음 = 판크기();

    game.look(0.3, 0.2);
    for (let tick = 301; tick <= 360; tick++) game.update(tick);
    expect(판크기() / 처음).toBeCloseTo(C.viewZoom, 3);

    game.aim(0.5, 0.5);
    for (let tick = 361; tick <= 420; tick++) game.update(tick);
    expect(판크기()).toBeCloseTo(처음, 3);
    // 돌려 뒀던 시선도 판 한가운데로 돌아온다.
    expect(game.getPosition().a).toBeCloseTo(C.screenWidth / 2, 6);
    expect(game.getPosition().b).toBeCloseTo(C.screenHeight / 2, 6);
  });

  it("돌려도 겨누는 자리는 판 안에 남는다", () => {
    const game = at(9, 300);
    for (let i = 0; i < 20; i++) game.look(1, 1); // 끝까지 돌린다
    const far = game.getPosition();
    expect(far.a).toBeGreaterThanOrEqual(0);
    expect(far.a).toBeLessThanOrEqual(C.screenWidth);
    expect(far.b).toBeGreaterThanOrEqual(0);
    expect(far.b).toBeLessThanOrEqual(C.screenHeight);

    for (let i = 0; i < 40; i++) game.look(-1, -1); // 반대쪽 끝까지
    const near = game.getPosition();
    expect(near.a).toBeGreaterThanOrEqual(0);
    expect(near.b).toBeGreaterThanOrEqual(0);
  });

  it("돌려 둔 시선은 안 풀리고 반동만 잦아든다", () => {
    // ⚠️ 둘을 한 값에 합쳐 두면 반동 상한(68px)이 시선까지 잘라 판을 못 돈다.
    const game = at(9, 300);
    game.look(0.25, 0);
    const turned = game.getPosition().a;
    expect(Math.abs(turned - C.screenWidth / 2)).toBeGreaterThan(C.recoilMax);

    game.fire(0.5, 0.5); // 반동을 얹는다
    for (let tick = 301; tick <= 460; tick++) game.update(tick); // 충분히 기다린다
    // 반동은 사라지고 돌려 둔 시선만 남는다.
    expect(game.getPosition().a).toBeCloseTo(turned, 0);
  });

  it("조준이 붙기 전에는 안내가 뜨고, 붙으면 걷힌다", () => {
    const probe = new ScreenProbe();
    const fresh = at(9, 60);
    fresh.render(probe.reset());
    expect(probe.texts.some((t) => t.text.includes("클릭"))).toBe(true);

    fresh.look(0.01, 0);
    fresh.render(probe.reset());
    expect(probe.texts.some((t) => t.text.includes("클릭"))).toBe(false);
  });

  it("궤적이 고정이다 — 외워서 끌어내릴 수 있다", () => {
    // 같은 순서로 쏘면 언제나 같은 자리로 밀린다. 난수가 섞이면 이게 깨진다.
    const run = () => {
      const game = at(9, 300);
      const path: string[] = [];
      let tick = 300;
      for (let shot = 0; shot < 8; shot++) {
        game.aim(0.5, 0.5);
        game.fire(0.5, 0.5);
        const p = game.getPosition();
        path.push(`${p.a.toFixed(3)},${p.b.toFixed(3)}`);
        game.update(++tick);
      }
      return path;
    };
    expect(run()).toEqual(run());
    // 좌우로도 흔들린다 — 아래로 곧게 끌어내리는 것만으로는 안 된다.
    expect(new Set(run().map((p) => p.split(",")[0])).size).toBeGreaterThan(1);
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
  /** 십자 조준점이 가로로 벌어진 폭(굵기 2인 선들의 양 끝 거리).
   *  ⚠️ 선 **길이**를 재면 안 된다 — 반동은 팔과 가운데 틈을 **같이** 키우므로 길이는
   *     그대로다. 벌어진 폭으로 봐야 반동이 보인다(처음에 길이로 쟀다가 헛짚었다). */
  crossSpan = 0;
  /** 십자의 가로 한가운데 = **조준점이 그려진 자리**. 마우스에 붙어 있는지 볼 때 쓴다. */
  crossCenter = NaN;
  /** 그린 순서. 층이 뒤바뀌지 않았는지 보려고 남긴다. */
  ops: string[] = [];
  private crossMin = Infinity;
  private crossMax = -Infinity;

  reset(): this {
    this.circles = [];
    this.texts = [];
    this.crossSpan = 0;
    this.crossCenter = NaN;
    this.ops = [];
    this.crossMin = Infinity;
    this.crossMax = -Infinity;
    return this;
  }
  clear(): void {}
  rect(): void {}
  circle(x: number, y: number, r: number, color: string): void {
    this.circles.push({ x, y, r, color });
    this.ops.push(`circle:${r.toFixed(2)}`);
  }
  text(text: string, x: number, y: number, color: string): void {
    this.texts.push({ text, x, y, color });
  }
  line(x1: number, _y1: number, x2: number, _y2: number, _color: string, width?: number): void {
    this.ops.push(`line:${width ?? 1}`);
    if (width !== 2) return;
    this.crossMin = Math.min(this.crossMin, x1, x2);
    this.crossMax = Math.max(this.crossMax, x1, x2);
    this.crossSpan = this.crossMax - this.crossMin;
    this.crossCenter = (this.crossMax + this.crossMin) / 2;
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

  it("쏘면 조준점이 크게 벌어졌다 돌아온다 — 눌린 게 눈에도 보인다", () => {
    const game = at(9, 300);
    const probe = new ScreenProbe();
    game.render(probe.reset());
    const resting = probe.crossSpan;

    game.fire(0.5, 0.5);
    game.render(probe.reset());
    // 실기기에서 "반동이 없다"는 말을 들은 값이 8tick·팔 1.5배였다. 눈에 띄려면
    // 이만큼은 벌어져야 한다 — 얼마나 벌어지는지를 숫자로 못 박아 둔다.
    expect(probe.crossSpan).toBeGreaterThan(resting * 2);

    for (let tick = 301; tick <= 340; tick++) game.update(tick);
    game.render(probe.reset());
    expect(probe.crossSpan).toBe(resting); // 제자리로 돌아온다
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

    // ⚠️ **과녁만** 센다. 맞힌 자리에는 파열·섬광도 그려지므로 "그 자리에 원이 있나"로는
    //    구별이 안 된다(처음에 그렇게 쟀다가 헛짚었다). 과녁 테는 정확히 반지름 C.radius다.
    const targetDrawn = () =>
      probe.circles.some((c) => Math.abs(c.x - t.x) < 1 && Math.abs(c.r - C.radius) < 0.01);

    game.fire(t.x / C.screenWidth, t.y / C.screenHeight);
    game.render(probe.reset());
    expect(targetDrawn()).toBe(false);

    game.renderSpectator(probe.reset(), { id: "남", a: 10, b: 10, label: "남" });
    expect(targetDrawn()).toBe(true);
  });

  it("남이 쏜 순간에만 관전 화면에 섬광이 뜬다", () => {
    const game = at(9, 300);
    const probe = new ScreenProbe();
    // ⚠️ 반지름 5 위만 센다. 남의 조준점도 그 사람이 쏜 직후엔 반동으로 가운데 점을
    //    찍으므로(반지름 2), 그냥 세면 섬광과 점이 함께 잡힌다.
    const spectate = () => {
      game.renderSpectator(probe.reset(), { id: "남", a: 400, b: 700, label: "남" });
      return probe.circles.filter(
        (c) => Math.abs(c.x - 400) < 1 && Math.abs(c.y - 700) < 1 && c.r > 5,
      ).length;
    };
    expect(spectate()).toBe(0);
    game.applyPeerEvent("남", "h");
    expect(spectate()).toBe(1);
    for (let tick = 301; tick <= 330; tick++) game.update(tick);
    expect(spectate()).toBe(0); // 잠깐만 뜬다
  });

});
