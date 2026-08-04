/* KeyEntry — 키보드 타자를 슬러그로.

   폴링(InputManager)과 달리 이건 푸시라 "언제 몇 번 불렸는가"가 곧 계약이다.
   브라우저 단축키를 삼키거나, 자동 반복으로 한 번 누른 게 열 번이 되면 조작이
   망가진다 — 눈으로는 잡기 어려운 종류라 여기서 못 박는다. */
import { describe, expect, it } from "vitest";
import { KeyEntry, keyToSlug } from "../packages/core/src/input/KeyEntry";

type Handler = (event: KeyboardEvent) => void;

/** window 흉내. 등록된 keydown 핸들러에 사건을 밀어 넣는다. */
class FakeWindow {
  private handlers: Handler[] = [];
  prevented = 0;

  addEventListener(type: string, fn: Handler): void {
    if (type === "keydown") this.handlers.push(fn);
  }

  removeEventListener(type: string, fn: Handler): void {
    if (type === "keydown") this.handlers = this.handlers.filter((h) => h !== fn);
  }

  press(key: string, extra: Partial<KeyboardEvent> = {}): void {
    const event = {
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      repeat: false,
      preventDefault: () => {
        this.prevented++;
      },
      ...extra,
    } as KeyboardEvent;
    for (const fn of [...this.handlers]) fn(event);
  }

  get listening(): boolean {
    return this.handlers.length > 0;
  }
}

function wire(): { win: FakeWindow; keys: string[]; entry: KeyEntry } {
  const win = new FakeWindow();
  const keys: string[] = [];
  const entry = new KeyEntry((slug) => keys.push(slug), win as unknown as Window);
  entry.start();
  return { win, keys, entry };
}

describe("키 → 슬러그", () => {
  it("숫자는 그대로, 지우기와 제출은 이름으로", () => {
    expect(keyToSlug("0")).toBe("0");
    expect(keyToSlug("9")).toBe("9");
    expect(keyToSlug("Backspace")).toBe("back");
    expect(keyToSlug("Enter")).toBe("enter");
  });

  it("나머지는 전부 null", () => {
    for (const key of ["a", "A", "ArrowUp", "Shift", " ", "Escape", "F5", "가"]) {
      expect(keyToSlug(key)).toBeNull();
    }
  });
});

describe("키보드 듣기", () => {
  it("누른 순서대로 넘긴다", () => {
    const { win, keys } = wire();
    for (const key of ["1", "2", "3", "Enter"]) win.press(key);
    expect(keys).toEqual(["1", "2", "3", "enter"]);
  });

  it("우리가 쓰는 키만 기본 동작을 막는다 — Backspace 뒤로가기, Enter 버튼 누름", () => {
    const { win, keys } = wire();
    win.press("Backspace");
    win.press("F5");
    expect(keys).toEqual(["back"]);
    expect(win.prevented).toBe(1); // F5는 건드리지 않았다
  });

  it("브라우저 단축키는 통째로 비켜 준다", () => {
    const { win, keys } = wire();
    win.press("1", { ctrlKey: true });
    win.press("r", { metaKey: true });
    win.press("Enter", { altKey: true });
    expect(keys).toEqual([]);
    expect(win.prevented).toBe(0);
  });

  it("꾹 눌러 생기는 자동 반복은 무시한다", () => {
    const { win, keys } = wire();
    win.press("Backspace");
    win.press("Backspace", { repeat: true });
    win.press("Backspace", { repeat: true });
    expect(keys).toEqual(["back"]);
  });

  it("stop하면 리스너가 걷히고, start를 두 번 해도 두 번 안 온다", () => {
    const { win, keys, entry } = wire();
    entry.start(); // 중복 호출
    win.press("1");
    expect(keys).toEqual(["1"]);
    entry.stop();
    expect(win.listening).toBe(false);
    win.press("2");
    expect(keys).toEqual(["1"]);
  });
});
