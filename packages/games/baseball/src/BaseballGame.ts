/* ============================================================
   BaseballGame — 숫자 야구. IGame 구현. (네 번째 게임)
   ------------------------------------------------------------
   앞의 셋과 다른 점이 이 게임의 존재 이유다.

   1) **판이 없다.** 회피할 것도 밟을 바닥도 없다. 시드가 정하는 건 위치가 아니라
      **문제열**이고, 화면은 지금까지 물어본 것과 그 대답을 적어 둔 종이다.

   2) **입력이 글자다.** 방향 넷으로는 숫자를 못 친다. IGame에 typeKey를 하나
      열었다(계약 파일 주석 참조). update는 시계만 본다 — 이 게임의 진행은
      tick이 아니라 사람이 친 순서로만 움직인다.

   3) **기록이 시간이 아니라 점수다.** getScore()가 생존 tick이 아니라 누적 점수를
      돌려준다. 서버는 여전히 "클수록 좋은 숫자 하나"만 보므로 손댈 게 없다.

   판정은 전부 rules.ts에 있다(순수 함수). 여기 있는 건 화면과 입력뿐이다.
   ============================================================ */

import type { IGame, IRenderer, SpectateSignal, SpectateTarget } from "@arcade/shared";
import { baseballConfig as C } from "./config";
import {
  REASONS,
  allDistinct,
  isOver,
  parseGuess,
  startGame,
  submitGuess,
  ticksLeft,
  type Attempt,
  type BaseballState,
} from "./rules";

const BACKDROP = "#15171d";
const PANEL = "#1e2129"; // 기록판
const HUD = "#e8eef2";
const DIM = "#8b95a3";
const ME = "#e63946";
const STRIKE = "#f4a261";
const BALL = "#a8dadc";
const GOOD = "#90be6d";
const SPENT = "#3a3f4b"; // 써 버린 기회

/** 화면 안쪽 여백. */
const PAD = 60;
/** 기록 한 줄의 높이(px). */
const ROW = 42;
/** 정답·오류 알림이 떠 있는 시간(tick). 70 ≈ 1.2초. */
const NOTICE_TICKS = 70;

export class BaseballGame implements IGame {
  private state!: BaseballState;
  /** 지금 치고 있는 숫자들. 아직 낸 게 아니다. */
  private entry: number[] = [];
  private worldTick = 0;
  /** 알림 문구와 그게 뜬 시각. 잠깐 떴다 사라진다. */
  private notice = "";
  private noticeAt = -999;
  private noticeGood = false;
  private readonly sounds = new Set<string>();

  init(seed: number): void {
    this.state = startGame(seed);
    this.entry = [];
    this.worldTick = 0;
    this.notice = "";
    this.noticeAt = -999;
    this.noticeGood = false;
    this.sounds.clear();
  }

  /** ⚠️ input을 안 받는다. 이 게임에서 방향키는 아무 뜻이 없고, 진행은 typeKey로만
   *  일어난다. 여기서 하는 일은 시계를 읽는 것뿐이다(제한시간 판정용). */
  update(tick: number): void {
    this.worldTick = tick;
  }

  /* ---- 입력 --------------------------------------------------------------- */

  /** 슬러그 하나를 처리한다. `"0"`~`"9"` · `"back"` · `"enter"`.
   *  ⚠️ 끝난 판에서는 아무것도 받지 않는다 — 시간이 다 된 뒤 도착한 Enter가
   *  한 문제를 더 맞히면 결과 화면과 순위 기록이 어긋난다. */
  typeKey(key: string): void {
    if (isOver(this.state, this.worldTick)) return;
    if (key === "back") {
      this.entry.pop();
      return;
    }
    if (key === "enter") {
      this.commit();
      return;
    }
    const digit = Number(key);
    if (!Number.isInteger(digit) || key.length !== 1) return;
    if (this.entry.length >= C.digits) return;
    // 겹치는 숫자는 아예 안 들어간다. 낸 뒤에 물리는 것보다 눌러도 안 찍히는 쪽이
    // 빠르고, 왜 안 되는지는 알림 한 줄로 말해 준다.
    // ⚠️ 판단도 문구도 rules에서 가져온다 — 여기서 다시 적으면 규칙을 고칠 때 화면만
    //    옛 규칙으로 남아, 화면이 막는 것과 규칙이 받는 것이 갈린다.
    if (!allDistinct([...this.entry, digit])) {
      this.say(REASONS.duplicate, false);
      return;
    }
    this.entry.push(digit);
    this.sounds.add("type");
  }

  /** 지금 친 숫자를 낸다. 낼 수 있는지는 rules.parseGuess가 정한다 — 화면은 그 판단을
   *  옮겨 적지 않는다(치는 도중에 미리 막는 것도 rules.allDistinct를 쓴다). */
  private commit(): void {
    const parsed = parseGuess(this.entry.join(""));
    if (!parsed.ok) {
      this.say(parsed.reason, false);
      return;
    }
    const out = submitGuess(this.state, parsed.guess);
    this.state = out.state;
    this.entry = [];
    if (out.solved) {
      this.say(`정답! +${out.gained}점`, true);
      this.sounds.add("solve");
      return;
    }
    this.say(label(out.attempt), false);
    this.sounds.add(out.attempt.strikes + out.attempt.balls === 0 ? "out" : "miss");
  }

  private say(text: string, good: boolean): void {
    this.notice = text;
    this.noticeAt = this.worldTick;
    this.noticeGood = good;
  }

  /* ---- 렌더 -------------------------------------------------------------- */

  render(r: IRenderer): void {
    this.drawFrame(r);
    this.drawStatus(r, `${this.state.puzzle + 1}번째 문제`, this.state.score);
    this.drawAttempts(r, this.state.attempts);
    if (isOver(this.state, this.worldTick)) {
      this.drawEnd(r);
      return;
    }
    this.drawEntry(r);
    this.drawNotice(r);
  }

  /** 관전 화면. 남의 기록판은 받아 볼 수 없다 — 위치 중계에 실려 오는 건 숫자 둘뿐이라
   *  거기에 **진척도**를 싣기로 했다(getPosition 주석 참조). 그래서 여기서는 그 사람이
   *  몇 문제를 풀었고 몇 점인지만 보여 준다. */
  renderSpectator(r: IRenderer, target: SpectateTarget): void {
    this.drawFrame(r);
    r.text(`관전: ${target.label}`, PAD, PAD - 14, HUD, 20);
    const cx = C.screenWidth / 2;
    r.text(`${Math.round(target.a)}문제`, cx, C.screenHeight / 2 - 30, HUD, 44, "center");
    r.text(`${Math.round(target.b)}점`, cx, C.screenHeight / 2 + 40, GOOD, 36, "center");
  }

  private drawFrame(r: IRenderer): void {
    r.clear();
    r.rect(0, 0, C.screenWidth, C.screenHeight, BACKDROP);
    r.rect(PAD - 20, PAD + 60, C.screenWidth - (PAD - 20) * 2, C.screenHeight - PAD * 2 - 60, PANEL);
  }

  /** 위쪽 줄: 남은 시간 막대 · 문제 번호 · 점수 · 남은 기회. */
  private drawStatus(r: IRenderer, title: string, score: number): void {
    const left = PAD - 20;
    const width = C.screenWidth - left * 2;

    // 남은 시간은 막대로 — 숫자보다 "얼마 안 남았다"가 곁눈으로 읽힌다.
    const left0 = ticksLeft(this.worldTick) / C.timeLimitTicks;
    r.rect(left, PAD - 6, width, 10, SPENT);
    r.rect(left, PAD - 6, width * left0, 10, left0 < 0.25 ? ME : GOOD);

    r.text(title, left, PAD + 34, HUD, 24);
    // 오른쪽 끝에 붙인다. 예전엔 글자 수 × 15로 폭을 어림했는데, 점수가 세 자리가 되면
    // 그만큼 밀렸다 — 폭을 아는 건 렌더러이니 자리만 알려 준다.
    r.text(`${score}점`, C.screenWidth - left, PAD + 34, GOOD, 24, "right");

    // 기회는 점으로 — 개수가 적어 세는 것보다 보이는 게 빠르다.
    for (let i = 0; i < C.maxChances; i++) {
      const x = left + 8 + i * 22;
      r.circle(x, PAD + 56, 7, i < this.state.chances ? ME : SPENT);
    }
  }

  /** 지금 문제에서 물어본 것들. 최근 것이 아래로 쌓인다. */
  private drawAttempts(r: IRenderer, attempts: readonly Attempt[]): void {
    const top = PAD + 120;
    // 판이 넘칠 만큼 쌓이면(기회 상한만큼) 오래된 것부터 밀어낸다.
    const room = Math.floor((C.screenHeight - PAD - 140 - top) / ROW);
    const shown = attempts.slice(Math.max(0, attempts.length - room));
    const skipped = attempts.length - shown.length;
    shown.forEach((attempt, i) => {
      const y = top + i * ROW;
      r.text(`${skipped + i + 1}.`, PAD, y, DIM, 22);
      r.text(attempt.guess.join(" "), PAD + 50, y, HUD, 28);
      // 판정 글자는 marks 하나에서 온다(알림 줄과 같은 말). 여기서 정하는 건 자리와
      // 색뿐이다 — 칸을 고정으로 두면 여러 줄이 쌓였을 때 S와 B가 세로로 맞는다.
      for (const mark of marks(attempt)) {
        r.text(mark.text, PAD + 200 + mark.column * 50, y, mark.color, mark.size);
      }
    });
  }

  /** 지금 치고 있는 자리. 빈 칸은 밑줄로 몇 자리인지 보여 준다. */
  private drawEntry(r: IRenderer): void {
    const y = C.screenHeight - PAD - 90;
    for (let i = 0; i < C.digits; i++) {
      const x = PAD + 20 + i * 70;
      const digit = this.entry[i];
      if (digit === undefined) r.rect(x, y + 6, 44, 4, DIM);
      else r.text(String(digit), x + 8, y, HUD, 44);
    }
    r.text("숫자를 치고 Enter", PAD + 250, y - 6, DIM, 20);
  }

  private drawNotice(r: IRenderer): void {
    if (this.worldTick - this.noticeAt > NOTICE_TICKS) return;
    r.text(this.notice, PAD, C.screenHeight - PAD - 20, this.noticeGood ? GOOD : STRIKE, 26);
  }

  private drawEnd(r: IRenderer): void {
    const cx = C.screenWidth / 2;
    const why = this.state.chances <= 0 ? "기회를 다 썼다" : "시간 끝";
    r.text(why, cx, C.screenHeight / 2 - 20, ME, 32, "center");
    r.text(`${this.state.solved}문제 · ${this.state.score}점`, cx, C.screenHeight / 2 + 40, HUD, 30, "center");
  }

  /* ---- IGame 나머지 ------------------------------------------------------ */

  consumeSounds(): readonly string[] | null {
    if (this.sounds.size === 0) return null;
    const out = [...this.sounds];
    this.sounds.clear();
    return out;
  }

  isPlayerDead(): boolean {
    return isOver(this.state, this.worldTick);
  }

  /** 관전 중계에 **위치 대신 진척도를 싣는다** — a=푼 문제 수 / b=점수.
   *  이 게임엔 좌표가 없고 통로는 숫자 둘이라(SpectateSignal), 그 둘에 무엇을 담을지는
   *  게임이 정한다. ⚠️ renderSpectator가 같은 뜻으로 읽어야 한다 — 둘은 한 쌍이고,
   *  중간 프레임에는 보간된 소수가 오므로 받는 쪽에서 반올림한다. */
  getPosition(): SpectateSignal {
    return { a: this.state.solved, b: this.state.score };
  }

  /* syncPeers는 구현하지 않는다 — 남의 화면에 쌓을 로컬 시각 요소가 없다.
     관전에 필요한 숫자 둘은 SpectateTarget에 이미 실려 온다(선택 계약). */

  getScore(): number {
    return this.state.score;
  }

  /** 남은 시간 비율(0~1). HUD 게이지에 그대로 쓴다. */
  getGauge(): number {
    return ticksLeft(this.worldTick) / C.timeLimitTicks;
  }
}

/** 판정 하나를 사람이 읽는 조각들로. **이 게임에서 판정을 말하는 곳은 여기뿐이다** —
 *  알림 줄은 이어 붙여 한 줄로 쓰고(label), 기록판은 조각마다 색을 달리 칠한다.
 *  말은 한 곳에서 만들고 배치만 각자 정한다. */
type Mark = { text: string; color: string; size: number; column: number };

function marks(attempt: Attempt): Mark[] {
  if (attempt.strikes + attempt.balls === 0) return [{ text: "아웃", color: DIM, size: 24, column: 0 }];
  const out: Mark[] = [];
  if (attempt.strikes > 0) out.push({ text: `${attempt.strikes}S`, color: STRIKE, size: 26, column: 0 });
  if (attempt.balls > 0) out.push({ text: `${attempt.balls}B`, color: BALL, size: 26, column: 1 });
  return out;
}

/** "1S 2B" / "아웃" — 알림 줄이 쓰는 한 줄짜리 표기. */
function label(attempt: Attempt): string {
  return marks(attempt)
    .map((mark) => mark.text)
    .join(" ");
}
