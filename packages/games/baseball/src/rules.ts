/* ============================================================
   rules — 숫자 야구의 판정을 전부 순수 함수로
   ------------------------------------------------------------
   답을 뽑고, 스트라이크·볼을 세고, 기회와 점수를 굴린다. 여기엔 캔버스도
   입력도 tick 루프도 없다 — 그래서 Node에서 전부 시험할 수 있다.
   (커브 피버의 worldGen, 죽림고수의 스포너 계열과 같은 결.)

   ⚠️ **답은 시드와 문제 번호만으로 정해진다.** RNG 스트림을 하나 두고 문제마다
      한 번씩 뽑는 방식이 아니다. 그래야 같은 방의 두 사람이 서로 다른 속도로
      풀어도 **n번째 문제는 언제나 같은 문제**다. 스트림 방식이면 소비 횟수가
      갈리는 순간 사람마다 다른 문제를 풀게 된다 — 다른 게임에서 "RNG 소비
      순서가 곧 판의 정체성"이라고 적어 둔 함정을 여기서는 아예 없앴다.

   ⚠️ 상태(BaseballState)는 tick을 담지 않는다. 시간은 러너가 세는 것이고,
      끝났는지는 isOver(state, tick)로 물어본다 — 같은 사실을 두 곳에 두면
      반드시 어긋난다.
   ============================================================ */

import { SeededRNG } from "@arcade/shared";
import { baseballConfig as C } from "./config";

/** 한 번의 추측과 그 판정. */
export interface Attempt {
  readonly guess: readonly number[];
  /** 자리도 숫자도 맞은 개수. */
  readonly strikes: number;
  /** 숫자는 있지만 자리가 틀린 개수. */
  readonly balls: number;
}

export interface BaseballState {
  readonly seed: number;
  /** 몇 번째 문제인가(0부터). */
  readonly puzzle: number;
  /** 지금 문제의 답. */
  readonly secret: readonly number[];
  /** **지금 문제에서** 한 시도들. 문제를 넘어가면 비워진다. */
  readonly attempts: readonly Attempt[];
  /** 남은 기회. 0이면 끝이다. */
  readonly chances: number;
  /** 지금까지 쌓은 점수 = 순위 기록. */
  readonly score: number;
  /** 맞힌 문제 수. */
  readonly solved: number;
}

/** submitGuess의 결과. 상태만 주면 "방금 맞혔는지"를 밖에서 다시 계산해야 한다
 *  — 소리·연출이 그걸 알아야 하므로 함께 돌려준다. */
export interface GuessOutcome {
  readonly state: BaseballState;
  readonly attempt: Attempt;
  readonly solved: boolean;
  /** 이번 추측으로 얻은 점수(못 맞혔으면 0). */
  readonly gained: number;
}

export type ParseResult =
  | { readonly ok: true; readonly guess: number[] }
  | { readonly ok: false; readonly reason: string };

/* ---- 답 만들기 ---------------------------------------------------------- */

/** 0~9에서 서로 다른 숫자 digits개를 뽑는다(부분 피셔–예이츠).
 *  ⚠️ 뽑을 때까지 다시 굴리는 방식이 아니다 — 중복이 나올 수 없으므로 RNG
 *     소비 횟수가 언제나 digits로 고정된다. */
export function makeSecret(rng: SeededRNG, digits: number): number[] {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = 0; i < digits; i++) {
    const j = i + rng.int(pool.length - i);
    const swap = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = swap;
  }
  return pool.slice(0, digits);
}

/** (시드, 문제 번호) → 그 문제의 답. 같은 짝이면 언제 불러도 같은 답이 나온다.
 *  문제 번호를 황금비 상수로 섞어 시드를 만든다 — 그냥 seed+puzzle로 하면
 *  이웃한 시드의 판들이 한 칸씩 밀린 같은 문제열이 된다. */
export function secretFor(seed: number, puzzle: number): number[] {
  const rng = new SeededRNG((seed ^ Math.imul(puzzle + 1, 0x9e3779b1)) >>> 0);
  return makeSecret(rng, C.digits);
}

/* ---- 판정 --------------------------------------------------------------- */

/** 스트라이크·볼을 센다. 숫자가 서로 다르다는 전제라 개수 세기가 필요 없다. */
export function judge(secret: readonly number[], guess: readonly number[]): { strikes: number; balls: number } {
  let strikes = 0;
  let balls = 0;
  for (let i = 0; i < guess.length; i++) {
    const at = secret.indexOf(guess[i]!);
    if (at === i) strikes++;
    else if (at >= 0) balls++;
  }
  return { strikes, balls };
}

/** 서로 다른 숫자인가. 이 판단이 두 번 필요하다 — 낼 때(parseGuess) 한 번, 그리고 화면이
 *  치는 도중에 미리 막을 때 한 번. **같은 함수를 봐야 한다**: 한쪽만 고치면 화면이 막은
 *  것을 규칙은 받아 주거나(혹은 반대로) 하는, 사람이 보기엔 규칙이 흔들리는 상태가 된다. */
export function allDistinct(digits: readonly number[]): boolean {
  return new Set(digits).size === digits.length;
}

/** 규칙이 사람에게 하는 말. 화면이 같은 문구를 따로 적어 두면 규칙을 고칠 때 한쪽만 바뀐다. */
export const REASONS = {
  digitsOnly: "숫자만 넣을 수 있습니다.",
  duplicate: "숫자가 겹치면 안 됩니다.",
  length: (digits: number): string => `${digits}자리를 채워 주세요.`,
} as const;

/** 입력한 글자가 낼 수 있는 추측인지 본다. 낼 수 없으면 **왜 안 되는지**를 준다
 *  — 화면이 "안 됨"만 알면 플레이어는 뭘 고쳐야 할지 모른다.
 *
 *  ⚠️ 이미 낸 추측을 또 내는 건 막지 않는다. 정보가 없는 시도지만 그걸 아는 것도
 *     플레이어의 일이고, 규칙이 조용히 되돌리면 기회가 줄었는지 아닌지가 헷갈린다. */
export function parseGuess(text: string, digits: number = C.digits): ParseResult {
  const trimmed = text.trim();
  if (!/^[0-9]*$/.test(trimmed)) return { ok: false, reason: REASONS.digitsOnly };
  if (trimmed.length !== digits) return { ok: false, reason: REASONS.length(digits) };
  const guess = [...trimmed].map(Number);
  if (!allDistinct(guess)) return { ok: false, reason: REASONS.duplicate };
  return { ok: true, guess };
}

/** 한 문제를 그 횟수로 맞혔을 때 받는 점수. 기준(parGuesses)에서 아낀 만큼 오르고
 *  넘긴 만큼 깎인다 — **양쪽 다 비례한다.**
 *  ⚠️ 넘긴 쪽을 평평하게 두면(전부 basePoints) 헤맨 판이 다 같은 값이 되어, 이미
 *     기준을 넘긴 뒤에는 신중하게 좁히나 아무렇게나 찍으나 손해가 없어진다. */
export function solvePoints(guessesUsed: number): number {
  const scored = C.basePoints + (C.parGuesses - guessesUsed) * C.savedGuessPoints;
  return Math.max(C.minPoints, scored);
}

/* ---- 진행 --------------------------------------------------------------- */

export function startGame(seed: number): BaseballState {
  return {
    seed,
    puzzle: 0,
    secret: secretFor(seed, 0),
    attempts: [],
    chances: C.startChances,
    score: 0,
    solved: 0,
  };
}

/** 추측 하나를 낸다. 맞히면 다음 문제로 넘어가고 기회를 돌려받는다.
 *
 *  전제: guess는 parseGuess를 통과한 값이다(자리 수·중복은 여기서 다시 안 본다).
 *
 *  ⚠️ 맞힌 시도도 기회를 **한 번 쓴다.** 쓰고 나서 solveReward를 받는다 —
 *     그래야 "한 문제에 몇 번 썼나"와 "기회가 몇 번 줄었나"가 같은 수다.
 *  ⚠️ 기회가 0이면 아무 일도 안 일어난다. 화면이 잠그긴 하지만, 규칙이 스스로
 *     막지 않으면 늦게 도착한 입력 하나가 음수 기회를 만든다. */
export function submitGuess(state: BaseballState, guess: readonly number[]): GuessOutcome {
  const judged = judge(state.secret, guess);
  const attempt: Attempt = { guess: [...guess], ...judged };
  if (state.chances <= 0) return { state, attempt, solved: false, gained: 0 };

  const used = state.attempts.length + 1;
  const left = state.chances - 1;
  const solved = judged.strikes === state.secret.length;
  if (!solved) {
    return {
      state: { ...state, attempts: [...state.attempts, attempt], chances: left },
      attempt,
      solved: false,
      gained: 0,
    };
  }

  const gained = solvePoints(used);
  const puzzle = state.puzzle + 1;
  return {
    state: {
      ...state,
      puzzle,
      secret: secretFor(state.seed, puzzle),
      attempts: [],
      chances: Math.min(C.maxChances, left + C.solveReward),
      score: state.score + gained,
      solved: state.solved + 1,
    },
    attempt,
    solved: true,
    gained,
  };
}

/** 끝났는가. 기회가 떨어졌거나 시간이 다 됐거나. */
export function isOver(state: BaseballState, tick: number): boolean {
  return state.chances <= 0 || tick >= C.timeLimitTicks;
}

/** 남은 시간(tick). 화면이 초로 바꿔 쓴다. */
export function ticksLeft(tick: number): number {
  return Math.max(0, C.timeLimitTicks - tick);
}
