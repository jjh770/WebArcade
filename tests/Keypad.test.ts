/* 화면 숫자판(숫자 야구의 폰 조작).

   포인터 이벤트 처리 자체는 브라우저에서 확인한다. 여기서 잡는 건 **DOM에만 적혀 있어
   조용히 어긋나는 것들**이다.

   1) 숫자판 버튼의 `data-key`는 게임이 아는 슬러그여야 한다. 오타가 나면 아무 일도
      안 일어나고, 타입도 테스트도 안 걸린다 — 눌러 봐야만 안다.
   2) 손가락과 키보드는 **같은 어휘**를 써야 한다. 한쪽에만 있는 키가 생기면 폰과
      데스크톱에서 되는 조작이 달라진다.
   3) 세로 예산을 선언한 조작면은 판의 아래 패딩 규칙에도 들어 있어야 한다. 빠지면
      판이 조작 위에 얹힌다 — 실기기에서만 드러나는 종류라 여기서 못 박는다. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { keyToSlug } from "../packages/core/src/input/KeyEntry";
import { SURFACE_CLASS } from "../packages/app/src/touchSchemes";
import { BaseballGame } from "../packages/games/baseball/src/BaseballGame";
import { baseballConfig as C } from "../packages/games/baseball/src/config";
import type { IRenderer } from "@arcade/shared";

const HTML = readFileSync(new URL("../packages/app/index.html", import.meta.url), "utf8");
/* 조작면의 세로 예산은 판에 붙는 규칙이라 play.css가 갖는다(index.html은 마크업만).
   여기서 굳이 파일을 갈라 읽는 이유: 이 테스트가 지키는 건 **CSS와 코드의 접점**이지
   그것이 어느 파일에 있느냐가 아니다. 스타일을 또 나누면 이 줄만 따라오면 된다. */
const PLAY_CSS = readFileSync(new URL("../packages/app/src/styles/play.css", import.meta.url), "utf8");

/** #keypad 안의 data-key 값들(마크업 순서 그대로). */
function keypadSlugs(): string[] {
  const block = /<div id="keypad"[\s\S]*?<\/div>/.exec(HTML);
  expect(block, "index.html에 #keypad가 있어야 한다").not.toBeNull();
  return [...block![0].matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]!);
}

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
  has(needle: string): boolean {
    return this.texts.some((t) => t.includes(needle));
  }
}

function draw(game: BaseballGame): Capture {
  const r = new Capture();
  game.render(r); // 이 게임은 보간 alpha를 안 받는다(고정 화면이라 쓸 데가 없다).
  return r;
}

describe("숫자판 배치", () => {
  it("0~9가 하나씩, 지우기와 확인이 있다", () => {
    const slugs = keypadSlugs();
    expect(slugs).toHaveLength(12);
    for (let d = 0; d <= 9; d++) expect(slugs.filter((s) => s === String(d))).toHaveLength(1);
    expect(slugs).toContain("back");
    expect(slugs).toContain("enter");
  });

  it("손가락과 키보드가 같은 어휘를 쓴다 — 폰에서만 되는 조작이 없다", () => {
    const fromKeyboard = new Set(
      ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "Backspace", "Enter"]
        .map(keyToSlug)
        .filter((s): s is string => s !== null),
    );
    expect(new Set(keypadSlugs())).toEqual(fromKeyboard);
  });
});

describe("숫자판 슬러그를 게임이 알아듣는다", () => {
  const game = (): BaseballGame => {
    const g = new BaseballGame();
    g.init(42);
    g.update(0);
    return g;
  };

  it("숫자 버튼은 그 숫자를 찍는다", () => {
    for (const slug of keypadSlugs().filter((s) => /^[0-9]$/.test(s))) {
      const g = game();
      g.typeKey(slug);
      expect(draw(g).has(slug)).toBe(true);
    }
  });

  it("지우기 버튼은 마지막 한 글자를 지운다", () => {
    const g = game();
    for (const k of ["1", "2", "3"]) g.typeKey(k);
    g.typeKey("back");
    g.typeKey("4");
    g.typeKey("enter");
    expect(draw(g).has("1 2 4")).toBe(true);
  });

  it("확인 버튼은 제출한다", () => {
    const g = game();
    for (const k of ["1", "2", "3"]) g.typeKey(k);
    expect(draw(g).has("1.")).toBe(false); // 아직 안 냈다
    g.typeKey("enter");
    expect(draw(g).has("1.")).toBe(true); // 기록판 첫 줄이 생겼다
  });
});

describe("조작면의 세로 예산", () => {
  /** `body.controls-X { --control-h: ... }`를 선언한 조작면들. */
  const declared = [...PLAY_CSS.matchAll(/body\.(controls-[a-z]+)[^{]*\{[^}]*--control-h/g)]
    .flatMap((m) => [...m[0].matchAll(/controls-[a-z]+/g)].map((x) => x[0]));

  it("세로를 먹는다고 선언한 조작면은 판의 아래 패딩 규칙에도 있다", () => {
    // 이게 어긋나면 판은 뷰포트 전체 기준 가운데 정렬이라 조작 위에 얹힌다.
    const rule = /@media \(orientation: portrait\)\s*\{\s*([^{]*)\{\s*padding-bottom/.exec(PLAY_CSS);
    expect(rule, "세로 화면의 #play 패딩 규칙을 찾지 못했다").not.toBeNull();
    for (const cls of new Set(declared)) expect(rule![1]).toContain(cls);
  });

  it("숫자판도 그중 하나다", () => {
    expect(declared).toContain("controls-keypad");
  });

  /* 조작면과 CSS의 접점은 SURFACE_CLASS 하나다(touchSchemes). 양방향으로 못 박는다:
     표에만 있으면 자리를 선언 안 한 조작면이 판을 덮고, CSS에만 있으면 아무도 안 붙이는
     클래스가 남아 다음 사람이 그게 죽은 규칙인지 알 수 없다. */
  it("코드가 붙이는 클래스와 CSS가 선언한 클래스가 같다", () => {
    expect(new Set(declared)).toEqual(new Set(Object.values(SURFACE_CLASS)));
  });
});
