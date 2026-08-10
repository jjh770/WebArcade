/* 무너지는 바닥 — 세 번째 게임의 결정론·조작 회귀.

   가장 중요한 불변식은 하나다: **붕괴 일정은 플레이어가 뭘 하든 똑같다.**
   어느 칸을 뽑을지 고르는 데 위치가 한 번이라도 끼면, 같은 방에서도 사람마다
   다른 바닥이 무너져 "내 화면엔 멀쩡했는데 죽었다"가 된다.

   두 번째는 조작이다. 이 게임은 InputState의 「누르고 있다」에서 「누른 순간」을
   직접 만들어 쓴다(계약을 안 넓히려고). 그 edge detection이 정확히 한 칸만
   움직이는지, 계속 누르면 제 박자로 반복되는지가 여기 걸려 있다. */
import { describe, expect, it } from "vitest";
import type { IRenderer, InputState } from "@arcade/shared";
import { FloorGame } from "../packages/games/floor/src/FloorGame";
import { floorConfig as C } from "../packages/games/floor/src/config";

const IDLE: InputState = { up: false, down: false, left: false, right: false };
const press = (dir: keyof InputState): InputState => ({ ...IDLE, [dir]: true });

const CELL = (C.screenWidth - C.margin * 2) / C.cols;
const WARN = "#ffd166";
const WARN_DEEP = "#f77f00";
const TILE = "#f1faee";

/** 바닥 칸만 골라 담는 렌더러. 색으로 상태를 되읽는다 — 내부 필드를 안 들여다본다. */
class FloorCapture implements IRenderer {
  readonly width = 800;
  readonly height = 800;
  solid: string[] = [];
  warn: string[] = [];
  clear(): void {}
  circle(): void {}
  text(): void {}
  line(): void {}
  rect(x: number, y: number, w: number, h: number, color: string): void {
    if (w >= C.screenWidth) return; // 배경
    const key = `${Math.round(x)},${Math.round(y)}`;
    if (color === TILE) this.solid.push(key);
    else if (color === WARN || color === WARN_DEEP) this.warn.push(key);
  }
  reset(): this {
    this.solid = [];
    this.warn = [];
    return this;
  }
}

/** 게임을 굴리며 매 tick "멀쩡한 칸 + 금 간 칸" 목록을 지문으로 남긴다. */
function floorFingerprint(inputAt: (tick: number) => InputState, ticks: number, seed = 777): string[] {
  const game = new FloorGame();
  game.init(seed);
  const capture = new FloorCapture();
  const out: string[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    game.update(tick, inputAt(tick));
    game.render(capture.reset(), 0);
    // 깜빡임은 tick 함수라 색이 번갈아 바뀐다 → 위치만 정렬해 담는다.
    out.push(`${capture.solid.sort().join("|")}##${capture.warn.sort().join("|")}`);
  }
  return out;
}

/** 위치(px)를 격자 칸으로 되돌린다.
 *  `+ 0`은 -0을 0으로 만든다 — 0번 칸에서 Math.round가 -0을 내면 toBe(0)이 어긋난다. */
function cellOf(game: FloorGame): { col: number; row: number } {
  const p = game.getPosition();
  return {
    col: Math.round((p.a - C.margin - CELL / 2) / CELL) + 0,
    row: Math.round((p.b - C.margin - CELL / 2) / CELL) + 0,
  };
}

describe("무너지는 바닥 — 결정론", () => {
  it("같은 시드·같은 입력이면 바닥이 tick 단위로 똑같다", () => {
    const a = floorFingerprint(() => IDLE, 900);
    const b = floorFingerprint(() => IDLE, 900);
    expect(a).toEqual(b);
  });

  it("⭐ 플레이어가 뭘 하든 붕괴 일정은 같다 — 위치가 끼면 방마다 판이 갈린다", () => {
    const still = floorFingerprint(() => IDLE, 900);
    const roaming = floorFingerprint(
      (tick) => press((["up", "right", "down", "left"] as const)[Math.floor(tick / 7) % 4]),
      900,
    );
    expect(roaming).toEqual(still);
  });

  it("시드가 다르면 다른 바닥이 나온다", () => {
    const a = floorFingerprint(() => IDLE, 600, 1);
    const b = floorFingerprint(() => IDLE, 600, 2);
    expect(a).not.toEqual(b);
  });

  it("시작 직후에는 유예가 있어 발밑이 바로 꺼지지 않는다", () => {
    const frames = floorFingerprint(() => IDLE, C.unlockTick);
    for (const frame of frames) expect(frame.endsWith("##")).toBe(true); // 금 간 칸 없음
  });
});

describe("무너지는 바닥 — 칸 단위 조작", () => {
  it("⭐ 꾹 누르고 있어도 한 칸뿐이다 — 자동 반복은 일부러 없다", () => {
    const game = new FloorGame();
    game.init(1);
    const start = cellOf(game);
    // 유예 안에서만 돌린다(바닥이 꺼져 죽으면 위치가 얼어 테스트가 거짓 통과한다).
    for (let tick = 0; tick < C.unlockTick; tick++) game.update(tick, press("right"));
    expect(game.isPlayerDead()).toBe(false);
    expect(cellOf(game).col).toBe(start.col + 1);
  });

  it("뗐다 다시 눌러야 또 한 칸 — 톡톡 눌러 정확히 놓는다", () => {
    const game = new FloorGame();
    game.init(1);
    const start = cellOf(game);
    for (let i = 0; i < 3; i++) {
      game.update(i * 2, press("right"));
      game.update(i * 2 + 1, IDLE);
    }
    expect(cellOf(game).col - start.col).toBe(3);
  });

  it("다른 방향을 새로 누르면 이전 키를 떼지 않았어도 그쪽으로 간다", () => {
    const game = new FloorGame();
    game.init(1);
    const start = cellOf(game);
    game.update(0, press("right"));
    game.update(1, { ...IDLE, right: true, down: true }); // 오른쪽을 누른 채 아래를 새로 누름
    const now = cellOf(game);
    expect(now.col).toBe(start.col + 1);
    expect(now.row).toBe(start.row + 1);
    // 그 뒤로는 둘 다 붙들고 있어도 더 안 간다 — 새로 눌린 게 없으니까.
    for (let tick = 2; tick < 60; tick++) game.update(tick, { ...IDLE, right: true, down: true });
    expect(cellOf(game)).toEqual(now);
  });

  it("격자 밖으로는 나가지 않는다 — 벽은 막을 뿐 죽이지 않는다", () => {
    const game = new FloorGame();
    game.init(1);
    // ⚠️ 유예(unlockTick) 안에서 끝낸다. 더 돌리면 도중에 바닥이 꺼져 죽고,
    //    죽으면 위치가 얼어붙어 "벽이 막았다"가 아닌데도 테스트가 통과해버린다.
    let tick = 0;
    const tap = (dir: "left" | "up") => {
      game.update(tick++, press(dir));
      game.update(tick++, IDLE); // 자동 반복이 없으니 한 칸마다 떼야 한다
    };
    for (let i = 0; i < C.cols; i++) tap("left"); // 칸 수만큼 두드리면 왼쪽 끝
    for (let i = 0; i < C.rows; i++) tap("up");
    expect(tick).toBeLessThan(C.unlockTick);
    const corner = cellOf(game);
    expect(game.isPlayerDead()).toBe(false); // 벽에 밀어붙인 것만으로는 안 죽는다
    expect(corner.col).toBe(0);
    expect(corner.row).toBe(0);
  });
});

describe("무너지는 바닥 — 난이도", () => {
  /** tick마다 "멀쩡한 칸이 몇 개인가"를 기록한다. 적을수록 어렵다. */
  function solidOverTime(ticks: number, seed = 31): number[] {
    const game = new FloorGame();
    game.init(seed);
    const capture = new FloorCapture();
    const out: number[] = [];
    for (let tick = 0; tick < ticks; tick++) {
      game.update(tick, IDLE); // 죽어도 공통 월드는 계속 도므로 바닥은 계속 무너진다
      game.render(capture.reset(), 0);
      out.push(capture.solid.length);
    }
    return out;
  }
  const mean = (xs: number[]) => xs.reduce((sum, v) => sum + v, 0) / xs.length;
  const CELLS = C.cols * C.rows;

  it("⭐ 시간이 갈수록 멀쩡한 칸이 확실히 줄어든다", () => {
    const solid = solidOverTime(3600); // 60초
    const early = mean(solid.slice(200, 500)); // 3~8초
    const late = mean(solid.slice(3000, 3300)); // 50~55초
    expect(late).toBeLessThan(early * 0.75); // 눈에 띄게 줄어야 "점점 어려워진다"가 된다
  });

  it("아무리 어려워져도 밟을 곳은 남는다 — 실력과 무관하게 죽는 판이 되면 안 된다", () => {
    const solid = solidOverTime(7200); // 120초, 난이도 상한에 한참 도달한 뒤
    const worst = Math.min(...solid.slice(3600));
    expect(worst).toBeGreaterThan(CELLS * 0.35);
  });
});

describe("무너지는 바닥 — 소리", () => {
  it("유예 동안에는 아무 소리도 안 난다", () => {
    const game = new FloorGame();
    game.init(9);
    for (let tick = 0; tick < C.unlockTick; tick++) {
      game.update(tick, IDLE);
      expect(game.consumeSounds()).toBeNull();
    }
  });

  it("칸이 뚫리는 순간 부서지는 소리를 낸다", () => {
    const game = new FloorGame();
    game.init(9);
    let heard = false;
    for (let tick = 0; tick < 600 && !heard; tick++) {
      game.update(tick, IDLE);
      heard = (game.consumeSounds() ?? []).includes("crack");
    }
    expect(heard).toBe(true);
  });

  it("한 물결에 여러 칸이 무너져도 소리는 하나다 — 겹쳐 봐야 커지기만 한다", () => {
    const game = new FloorGame();
    game.init(9);
    for (let tick = 0; tick < 900; tick++) {
      game.update(tick, IDLE);
      const sounds = game.consumeSounds() ?? [];
      expect(sounds.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("무너지는 바닥 — 죽음", () => {
  it("가만히 서 있으면 언젠가 발밑이 뚫려 죽는다", () => {
    const game = new FloorGame();
    game.init(4242);
    let tick = 0;
    while (!game.isPlayerDead() && tick < 20000) game.update(tick++, IDLE);
    expect(game.isPlayerDead()).toBe(true);
    expect(game.getScore()).toBe(tick - 1); // 생존시간 = 사망 tick
  });

  it("죽은 뒤에도 공통 월드는 계속 돈다 — 관전 배경이 멈추면 안 된다", () => {
    const game = new FloorGame();
    game.init(4242);
    let tick = 0;
    while (!game.isPlayerDead() && tick < 20000) game.update(tick++, IDLE);
    const capture = new FloorCapture();
    game.render(capture.reset(), 0);
    const atDeath = capture.warn.sort().join("|");
    for (let i = 0; i < 300; i++) game.update(tick++, IDLE);
    game.render(capture.reset(), 0);
    expect(capture.warn.sort().join("|")).not.toBe(atDeath);
  });

  it("죽어도 점수는 더 오르지 않는다", () => {
    const game = new FloorGame();
    game.init(4242);
    let tick = 0;
    while (!game.isPlayerDead() && tick < 20000) game.update(tick++, IDLE);
    const frozen = game.getScore();
    for (let i = 0; i < 300; i++) game.update(tick++, IDLE);
    expect(game.getScore()).toBe(frozen);
  });
});
