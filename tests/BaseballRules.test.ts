/* 숫자 야구 — 판정 규칙. 캔버스도 tick 루프도 없는 순수 함수라 여기서 전부 본다.

   이 게임의 불변식은 앞의 셋과 결이 다르다. 저기서는 "플레이어가 뭘 하든 월드는
   똑같다"가 핵심이었는데, 여기서는 월드가 곧 **문제열**이다. 그래서 지켜야 할 건
   "n번째 문제는 누가 언제 풀든 같은 문제"다 — 이게 깨지면 같은 방에서 서로 다른
   문제를 풀면서 점수를 겨루게 된다.

   나머지 절반은 산수다. 기회가 몇 개 남는지, 점수가 몇 점인지는 화면에서 눈으로
   확인하기 가장 나쁜 종류의 버그라 여기서 못 박아 둔다. */
import { describe, expect, it } from "vitest";
import { SeededRNG } from "@arcade/shared";
import {
  isOver,
  judge,
  makeSecret,
  parseGuess,
  secretFor,
  solvePoints,
  startGame,
  submitGuess,
  ticksLeft,
  type BaseballState,
} from "../packages/games/baseball/src/rules";
import { baseballConfig as C } from "../packages/games/baseball/src/config";

/** 정답을 그대로 내서 한 문제를 끝낸다(맞히는 데 쓴 횟수를 지정할 수 있게 헛방을 섞는다). */
function solveWith(state: BaseballState, wastes: number): BaseballState {
  let s = state;
  for (let i = 0; i < wastes; i++) s = submitGuess(s, wrongGuess(s.secret)).state;
  return submitGuess(s, s.secret).state;
}

/** 절대 정답이 아닌 추측 하나(자리 수·중복 규칙은 지킨다). */
function wrongGuess(secret: readonly number[]): number[] {
  for (let a = 0; a < 10; a++) {
    for (let b = 0; b < 10; b++) {
      for (let c = 0; c < 10; c++) {
        const g = [a, b, c];
        if (new Set(g).size === 3 && g.join("") !== secret.join("")) return g;
      }
    }
  }
  throw new Error("unreachable");
}

describe("답 만들기", () => {
  it("자리 수만큼, 서로 다른 숫자로 나온다", () => {
    for (let seed = 0; seed < 200; seed++) {
      const secret = makeSecret(new SeededRNG(seed), C.digits);
      expect(secret).toHaveLength(C.digits);
      expect(new Set(secret).size).toBe(C.digits);
      expect(secret.every((d) => d >= 0 && d <= 9)).toBe(true);
    }
  });

  it("0도 맨 앞에 온다 — 720가지를 다 쓴다", () => {
    const leading = new Set<number>();
    for (let seed = 0; seed < 500; seed++) leading.add(makeSecret(new SeededRNG(seed), C.digits)[0]!);
    expect(leading.has(0)).toBe(true);
    expect(leading.size).toBe(10);
  });

  it("RNG를 자리 수만큼만 쓴다 — 중복이 나올 수 없어 다시 굴리지 않는다", () => {
    let calls = 0;
    const counting = new SeededRNG(1);
    const inner = counting.next.bind(counting);
    counting.next = () => {
      calls++;
      return inner();
    };
    makeSecret(counting, C.digits);
    expect(calls).toBe(C.digits);
  });
});

describe("문제열", () => {
  it("같은 시드의 n번째 문제는 언제나 같다 — 이게 깨지면 같은 방에서 다른 문제를 푼다", () => {
    for (const puzzle of [0, 1, 7, 40]) {
      expect(secretFor(12345, puzzle)).toEqual(secretFor(12345, puzzle));
    }
  });

  it("문제를 넘길 때마다 새 문제가 나온다", () => {
    const seen = new Set<string>();
    for (let puzzle = 0; puzzle < 30; puzzle++) seen.add(secretFor(999, puzzle).join(""));
    // 720가지에서 30번 뽑으면 겹칠 수도 있으나, 연달아 같은 문제가 나오면 안 된다.
    expect(seen.size).toBeGreaterThan(25);
    for (let puzzle = 0; puzzle < 30; puzzle++) {
      expect(secretFor(999, puzzle)).not.toEqual(secretFor(999, puzzle + 1));
    }
  });

  it("이웃한 시드가 한 칸 밀린 같은 문제열이 되지 않는다", () => {
    const a = Array.from({ length: 6 }, (_, i) => secretFor(1000, i).join(""));
    const b = Array.from({ length: 6 }, (_, i) => secretFor(1001, i).join(""));
    expect(b.slice(0, 5)).not.toEqual(a.slice(1));
  });

  it("앞 문제를 안 풀어도 뒤 문제가 정해져 있다 — 스트림이 아니라 (시드, 번호) 함수다", () => {
    const fresh = startGame(777);
    const solvedTwice = solveWith(solveWith(fresh, 0), 0);
    expect(solvedTwice.puzzle).toBe(2);
    expect(solvedTwice.secret).toEqual(secretFor(777, 2));
  });
});

describe("스트라이크·볼 세기", () => {
  const secret = [1, 2, 3];

  it("다 맞으면 3스트라이크", () => {
    expect(judge(secret, [1, 2, 3])).toEqual({ strikes: 3, balls: 0 });
  });

  it("숫자만 맞고 자리가 틀리면 볼", () => {
    expect(judge(secret, [3, 1, 2])).toEqual({ strikes: 0, balls: 3 });
  });

  it("섞여 있으면 각각 센다", () => {
    expect(judge(secret, [1, 3, 2])).toEqual({ strikes: 1, balls: 2 });
    expect(judge(secret, [1, 2, 4])).toEqual({ strikes: 2, balls: 0 });
    expect(judge(secret, [4, 1, 5])).toEqual({ strikes: 0, balls: 1 });
  });

  it("하나도 없으면 아웃(0-0)", () => {
    expect(judge(secret, [4, 5, 6])).toEqual({ strikes: 0, balls: 0 });
  });

  it("스트라이크와 볼의 합은 겹치는 숫자 개수를 넘지 않는다", () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = makeSecret(new SeededRNG(seed), 3);
      const g = makeSecret(new SeededRNG(seed + 5000), 3);
      const { strikes, balls } = judge(s, g);
      expect(strikes + balls).toBe(g.filter((d) => s.includes(d)).length);
    }
  });
});

describe("추측 검사", () => {
  it("규칙에 맞으면 숫자 배열로 준다", () => {
    expect(parseGuess("012")).toEqual({ ok: true, guess: [0, 1, 2] });
    expect(parseGuess(" 907 ")).toEqual({ ok: true, guess: [9, 0, 7] });
  });

  it("자리 수가 안 맞으면 거부한다", () => {
    expect(parseGuess("12").ok).toBe(false);
    expect(parseGuess("1234").ok).toBe(false);
    expect(parseGuess("").ok).toBe(false);
  });

  it("숫자가 아니면 거부한다", () => {
    expect(parseGuess("12a").ok).toBe(false);
    expect(parseGuess("-12").ok).toBe(false);
  });

  it("숫자가 겹치면 거부한다 — 답에는 겹치는 숫자가 없다", () => {
    const result = parseGuess("112");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("겹치면");
  });

  it("왜 안 되는지를 알려 준다 — 이유가 다르면 문구도 다르다", () => {
    const reasons = ["12", "12a", "112"].map((text) => {
      const r = parseGuess(text);
      return r.ok ? "" : r.reason;
    });
    expect(new Set(reasons).size).toBe(3);
  });
});

describe("점수", () => {
  it("적게 쓸수록 높다", () => {
    expect(solvePoints(1)).toBeGreaterThan(solvePoints(2));
    expect(solvePoints(3)).toBe(90);
    expect(solvePoints(5)).toBe(70);
  });

  it("기준 횟수에서 위아래로 갈린다", () => {
    expect(solvePoints(C.parGuesses)).toBe(C.basePoints);
    expect(solvePoints(C.parGuesses - 1)).toBe(C.basePoints + C.savedGuessPoints);
    expect(solvePoints(C.parGuesses + 1)).toBe(C.basePoints - C.savedGuessPoints);
  });

  it("기준을 넘겨도 계속 깎인다 — 헤맨 판이 전부 같은 값이면 뒤에서는 찍어도 손해가 없다", () => {
    for (let used = C.parGuesses; used < C.maxChances; used++) {
      expect(solvePoints(used + 1)).toBeLessThan(solvePoints(used));
    }
  });

  it("맞히면 하한 아래로는 안 내려간다 — 0점이나 음수는 없다", () => {
    expect(solvePoints(100)).toBe(C.minPoints);
    expect(solvePoints(C.maxChances)).toBeGreaterThanOrEqual(C.minPoints);
  });

  it("점수가 서버 검사(신고값 ≤ 흐른 초×60)에 걸리지 않는다", () => {
    /* 혼자 기록 제출은 신고값이 흐른 시간(초×60)을 넘으면 거부한다
       (soloRules.checkClaim). 이 게임만 신고값이 tick이 아니라 점수라, 점수를
       크게 키우면 **잘한 판일수록 순위표에 안 올라가는** 일이 생긴다.

       전제: 한 문제를 푸는 데 아무리 빨라도 3초는 걸린다(세 자리를 치고, 판정을
       읽고, 다시 친다). 이 전제가 흔들릴 만큼 점수를 키울 때 이 줄이 먼저 깨진다. */
    const MIN_SECONDS_PER_SOLVE = 3;
    expect(solvePoints(1) / MIN_SECONDS_PER_SOLVE).toBeLessThan(60);
  });
});

describe("한 판 진행", () => {
  it("시작 상태", () => {
    const s = startGame(42);
    expect(s.chances).toBe(C.startChances);
    expect(s.score).toBe(0);
    expect(s.solved).toBe(0);
    expect(s.puzzle).toBe(0);
    expect(s.attempts).toEqual([]);
  });

  it("못 맞히면 기회가 하나 줄고 기록이 남는다", () => {
    const s = startGame(42);
    const out = submitGuess(s, wrongGuess(s.secret));
    expect(out.solved).toBe(false);
    expect(out.gained).toBe(0);
    expect(out.state.chances).toBe(C.startChances - 1);
    expect(out.state.attempts).toHaveLength(1);
    expect(out.state.attempts[0]!.guess).toEqual(wrongGuess(s.secret));
    expect(out.state.puzzle).toBe(0); // 문제는 그대로
  });

  it("맞히면 점수가 오르고 다음 문제로 넘어간다", () => {
    const s = startGame(42);
    const out = submitGuess(s, s.secret);
    expect(out.solved).toBe(true);
    expect(out.gained).toBe(solvePoints(1));
    expect(out.state.score).toBe(solvePoints(1));
    expect(out.state.solved).toBe(1);
    expect(out.state.puzzle).toBe(1);
    expect(out.state.secret).not.toEqual(s.secret);
    expect(out.state.attempts).toEqual([]); // 기록은 문제마다 새로
  });

  it("맞힌 시도도 기회를 쓴다 — 쓰고 나서 보상을 받는다", () => {
    // 기회를 상한 아래로 내려놓고 봐야 보상이 얼마인지 보인다.
    let s = startGame(42);
    for (let i = 0; i < 4; i++) s = submitGuess(s, wrongGuess(s.secret)).state;
    expect(s.chances).toBe(C.startChances - 4); // 5
    const after = submitGuess(s, s.secret).state;
    expect(after.chances).toBe(C.startChances - 4 - 1 + C.solveReward); // 5 - 1 + 5 = 9
  });

  it("기회는 상한을 넘지 않는다", () => {
    const s = startGame(42);
    const after = submitGuess(s, s.secret).state;
    expect(after.chances).toBe(C.maxChances); // 9 - 1 + 5 = 13 → 10
  });

  it("쓴 횟수만큼 점수가 깎인다 — 헛방을 섞으면 낮게 받는다", () => {
    const quick = solveWith(startGame(42), 0);
    const slow = solveWith(startGame(42), 3);
    expect(quick.score).toBe(solvePoints(1));
    expect(slow.score).toBe(solvePoints(4));
    expect(slow.score).toBeLessThan(quick.score);
  });

  it("점수는 문제를 넘어 쌓인다", () => {
    const two = solveWith(solveWith(startGame(42), 0), 0);
    expect(two.solved).toBe(2);
    expect(two.score).toBe(solvePoints(1) * 2);
  });
});

describe("끝나는 조건", () => {
  it("기회를 다 쓰면 끝난다", () => {
    let s = startGame(42);
    for (let i = 0; i < C.startChances; i++) {
      expect(isOver(s, 0)).toBe(false);
      s = submitGuess(s, wrongGuess(s.secret)).state;
    }
    expect(s.chances).toBe(0);
    expect(isOver(s, 0)).toBe(true);
  });

  it("기회가 0이면 더 낼 수 없다 — 늦게 도착한 입력이 음수를 만들지 않는다", () => {
    let s = startGame(42);
    for (let i = 0; i < C.startChances; i++) s = submitGuess(s, wrongGuess(s.secret)).state;
    const after = submitGuess(s, s.secret);
    expect(after.state).toBe(s); // 상태 자체가 그대로다
    expect(after.solved).toBe(false);
    expect(after.gained).toBe(0);
  });

  it("마지막 기회로 맞히면 살아난다", () => {
    let s = startGame(42);
    for (let i = 0; i < C.startChances - 1; i++) s = submitGuess(s, wrongGuess(s.secret)).state;
    expect(s.chances).toBe(1);
    const after = submitGuess(s, s.secret).state;
    expect(after.chances).toBe(C.solveReward);
    expect(isOver(after, 0)).toBe(false);
  });

  it("시간이 다 되면 기회가 남아도 끝난다", () => {
    const s = startGame(42);
    expect(isOver(s, C.timeLimitTicks - 1)).toBe(false);
    expect(isOver(s, C.timeLimitTicks)).toBe(true);
  });

  it("남은 시간은 음수로 내려가지 않는다", () => {
    expect(ticksLeft(0)).toBe(C.timeLimitTicks);
    expect(ticksLeft(C.timeLimitTicks + 600)).toBe(0);
  });
});
