/* 숫자 야구 — 게임 껍데기(입력·화면·IGame 계약).

   판정 산수는 BaseballRules.test.ts가 본다. 여기서 확인하는 건 그 규칙에 **사람이
   닿는 부분**이다: 친 글자가 어디로 가는지, 낼 수 없는 것을 냈을 때 기회가 축나지
   않는지, 판이 끝난 뒤에도 입력이 먹는지.

   마지막 항목이 이 게임에서 특히 위험하다. 앞의 셋은 죽으면 조작이 의미를 잃지만
   여기서는 시간이 끝나도 키보드는 그대로 있다 — 늦게 도착한 Enter 한 번이 결과
   화면과 순위 기록을 어긋나게 만들 수 있다. */
import { describe, expect, it } from "vitest";
import type { IRenderer } from "@arcade/shared";
import { BaseballGame } from "../packages/games/baseball/src/BaseballGame";
import { baseballConfig as C } from "../packages/games/baseball/src/config";
import { parseGuess, secretFor } from "../packages/games/baseball/src/rules";

const SEED = 42;

/** 그려진 글자만 모으는 렌더러. 내부 필드를 안 들여다보고 화면으로 확인한다. */
class Capture implements IRenderer {
  readonly width = C.screenWidth;
  readonly height = C.screenHeight;
  texts: string[] = [];
  clear(): void {}
  circle(): void {}
  rect(): void {}
  line(): void {}
  text(content: string): void {
    this.texts.push(content);
  }
  /** 지금 화면에 그 글자가 있는가(부분 일치). */
  has(needle: string): boolean {
    return this.texts.some((t) => t.includes(needle));
  }
}

/** 게임 하나를 만들어 tick까지 돌려 놓는다. */
function fresh(tick = 0): BaseballGame {
  const game = new BaseballGame();
  game.init(SEED);
  game.update(tick);
  return game;
}

function draw(game: BaseballGame): Capture {
  const r = new Capture();
  game.render(r, 0);
  return r;
}

function type(game: BaseballGame, keys: string): void {
  for (const key of keys) game.typeKey(key);
}

/** 지금 문제의 답을 그대로 쳐서 제출한다. */
function answer(game: BaseballGame, puzzle: number): void {
  type(game, secretFor(SEED, puzzle).join(""));
  game.typeKey("enter");
}

/** 답이 아닌 세 자리 하나. */
function wrong(puzzle: number): string {
  const secret = secretFor(SEED, puzzle).join("");
  for (const candidate of ["012", "345", "678"]) {
    if (candidate !== secret) return candidate;
  }
  throw new Error("unreachable");
}

describe("숫자 치기", () => {
  it("친 숫자가 화면에 찍힌다", () => {
    const game = fresh();
    type(game, "12");
    const r = draw(game);
    expect(r.has("1")).toBe(true);
    expect(r.has("2")).toBe(true);
  });

  it("자리 수를 넘겨 치면 무시한다", () => {
    const game = fresh();
    type(game, "1234");
    game.typeKey("enter");
    // 넷째 글자가 먹혔다면 "1234"가 아니라 "123"이 제출됐어야 한다 → 기록판에 123.
    expect(draw(game).has("1 2 3")).toBe(true);
  });

  it("겹치는 숫자는 아예 안 들어간다 — 왜 안 되는지도 말해 준다", () => {
    const game = fresh();
    type(game, "11");
    const r = draw(game);
    expect(r.has("겹치면")).toBe(true);
    // 한 자리만 찼으므로 Enter를 눌러도 낼 수 없다(기회가 안 줄어든다).
    game.typeKey("enter");
    expect(draw(game).has("1.")).toBe(false); // 기록판이 비어 있다
  });

  /* 아래 둘은 **같은 말을 두 곳에서 적지 않는지**를 본다. 화면이 규칙의 판단이나 문구를
     옮겨 적으면 규칙을 고칠 때 한쪽만 바뀌고, 사람 눈에는 규칙이 흔들리는 것으로 보인다
     — 화면은 막는데 규칙은 받아 주거나, 같은 상황에 다른 말을 하거나. */
  it("화면이 미리 막는 말과 규칙이 거부하는 말이 같다", () => {
    const game = fresh();
    type(game, "11");
    const rejected = parseGuess("112");
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(draw(game).texts).toContain(rejected.reason);
  });

  it("기록판과 알림이 같은 판정 글자를 쓴다", () => {
    const game = fresh();
    const secret = secretFor(SEED, 0);
    const spare = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !secret.includes(d));
    // 첫 자리만 맞고 나머지 둘은 답에 없는 숫자 → 1S 0B.
    type(game, `${secret[0]}${spare[0]}${spare[1]}`);
    game.typeKey("enter");
    // 한 번은 기록판 줄에서, 한 번은 알림 줄에서. 두 곳이 다른 말을 쓰면 하나만 남는다.
    expect(draw(game).texts.filter((t) => t === "1S")).toHaveLength(2);
  });

  it("back으로 한 글자씩 지운다", () => {
    const game = fresh();
    type(game, "123");
    game.typeKey("back");
    type(game, "4");
    game.typeKey("enter");
    expect(draw(game).has("1 2 4")).toBe(true);
  });

  it("모르는 슬러그는 무시한다", () => {
    const game = fresh();
    game.typeKey("shift");
    game.typeKey("");
    game.typeKey("10");
    type(game, "123");
    game.typeKey("enter");
    expect(draw(game).has("1 2 3")).toBe(true);
  });
});

describe("제출", () => {
  it("낸 추측과 판정이 기록판에 남는다", () => {
    const game = fresh();
    const guess = wrong(0);
    type(game, guess);
    game.typeKey("enter");
    const r = draw(game);
    expect(r.has(guess.split("").join(" "))).toBe(true);
    expect(r.has("1.")).toBe(true); // 첫 줄 번호
  });

  it("덜 채우고 Enter를 눌러도 기회가 축나지 않는다", () => {
    const game = fresh();
    type(game, "12");
    for (let i = 0; i < 20; i++) game.typeKey("enter");
    expect(draw(game).has("채워")).toBe(true);
    expect(game.isPlayerDead()).toBe(false); // 기회가 남아 있다
  });

  it("맞히면 점수가 오르고 다음 문제로 넘어간다", () => {
    const game = fresh();
    answer(game, 0);
    const r = draw(game);
    expect(r.has("정답")).toBe(true);
    expect(r.has("2번째 문제")).toBe(true);
    expect(game.getScore()).toBeGreaterThan(0);
  });

  it("문제를 넘어가면 기록판과 입력창이 비워진다", () => {
    const game = fresh();
    type(game, wrong(0));
    game.typeKey("enter");
    expect(draw(game).has("1.")).toBe(true);
    answer(game, 0);
    const r = draw(game);
    expect(r.has("1.")).toBe(false); // 앞 문제의 기록이 남아 있지 않다
  });

  it("치다 만 숫자는 문제를 넘어가며 사라진다", () => {
    const game = fresh();
    answer(game, 0);
    type(game, "9"); // 새 문제에서 치기 시작
    game.typeKey("back");
    game.typeKey("enter");
    expect(draw(game).has("채워")).toBe(true); // 빈 상태였다
  });
});

describe("끝난 뒤", () => {
  it("시간이 다 되면 죽은 것으로 친다", () => {
    const game = fresh();
    expect(game.isPlayerDead()).toBe(false);
    game.update(C.timeLimitTicks);
    expect(game.isPlayerDead()).toBe(true);
    expect(draw(game).has("시간 끝")).toBe(true);
  });

  it("시간이 끝난 뒤의 입력은 먹지 않는다 — 결과와 순위 기록이 어긋나면 안 된다", () => {
    const game = fresh();
    game.update(C.timeLimitTicks);
    const before = game.getScore();
    answer(game, 0);
    expect(game.getScore()).toBe(before);
  });

  it("기회를 다 쓰면 끝나고, 이유가 화면에 뜬다", () => {
    const game = fresh();
    for (let i = 0; i < C.startChances; i++) {
      type(game, wrong(0));
      game.typeKey("enter");
    }
    expect(game.isPlayerDead()).toBe(true);
    expect(draw(game).has("기회를 다 썼다")).toBe(true);
  });

  it("끝난 화면은 푼 문제 수와 점수를 함께 보여 준다", () => {
    const game = fresh();
    answer(game, 0);
    game.update(C.timeLimitTicks);
    const r = draw(game);
    expect(r.has("1문제")).toBe(true);
    expect(r.has(`${game.getScore()}점`)).toBe(true);
  });
});

describe("IGame 계약", () => {
  it("기록은 생존 tick이 아니라 점수다", () => {
    const game = fresh();
    game.update(3000); // 시간만 흘러도 점수는 0
    expect(game.getScore()).toBe(0);
    answer(game, 0);
    expect(game.getScore()).toBeGreaterThan(0);
  });

  it("게이지는 남은 시간 비율이다", () => {
    const game = fresh();
    expect(game.getGauge()).toBe(1);
    game.update(C.timeLimitTicks / 2);
    expect(game.getGauge()).toBeCloseTo(0.5);
    game.update(C.timeLimitTicks * 2);
    expect(game.getGauge()).toBe(0); // 음수로 내려가지 않는다
  });

  it("중계로 나가는 값은 좌표가 아니라 진척도다", () => {
    const game = fresh();
    answer(game, 0);
    const pos = game.getPosition();
    expect(pos.a).toBe(1); // 푼 문제 수
    expect(pos.b).toBe(game.getScore());
  });

  it("관전 화면은 그 사람의 진척도를 보여 준다", () => {
    const game = fresh();
    const r = new Capture();
    game.renderSpectator(r, { id: "p1", a: 3, b: 240, label: "남" });
    expect(r.has("관전: 남")).toBe(true);
    expect(r.has("3문제")).toBe(true);
    expect(r.has("240점")).toBe(true);
  });

  it("init하면 지난 판이 남지 않는다", () => {
    const game = fresh();
    answer(game, 0);
    type(game, "12");
    game.init(SEED);
    game.update(0);
    const r = draw(game);
    expect(game.getScore()).toBe(0);
    expect(r.has("1번째 문제")).toBe(true);
    expect(r.has("정답")).toBe(false);
  });

  it("소리는 낸 만큼만 나가고 가져가면 비워진다", () => {
    const game = fresh();
    type(game, "1");
    expect(game.consumeSounds()).toEqual(["type"]);
    expect(game.consumeSounds()).toBeNull();
    game.typeKey("back"); // 치던 걸 지우고 답을 친다
    answer(game, 0);
    expect(game.consumeSounds()).toContain("solve");
  });
});
