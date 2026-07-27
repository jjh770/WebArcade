/* 솔로 개인 최고기록 — localStorage 로직 회귀. Node엔 localStorage가 없으니
   가짜를 주입해 비교·저장·게임별 분리·차단 환경을 확인한다. */
import { beforeEach, describe, expect, it } from "vitest";
import { getBest, recordBest } from "../packages/app/src/personalBest";
import { loadNickname, saveNickname } from "../packages/app/src/prefs";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("개인 최고기록 (B — 솔로 localStorage)", () => {
  beforeEach(() => {
    (globalThis as { localStorage: Storage }).localStorage = fakeStorage();
  });

  it("첫 기록은 항상 새 기록이고 저장된다", () => {
    expect(recordBest("curve", 100)).toEqual({ best: 100, isNew: true });
    expect(getBest("curve")).toBe(100);
  });

  it("더 높은 점수만 갱신한다", () => {
    recordBest("curve", 100);
    expect(recordBest("curve", 80)).toEqual({ best: 100, isNew: false }); // 낮음 → 유지
    expect(recordBest("curve", 150)).toEqual({ best: 150, isNew: true }); // 높음 → 갱신
    expect(getBest("curve")).toBe(150);
  });

  it("게임마다 따로 저장한다", () => {
    recordBest("curve", 100);
    recordBest("jungnim", 50);
    expect(getBest("curve")).toBe(100);
    expect(getBest("jungnim")).toBe(50);
  });

  it("localStorage가 막혀 던져도 0을 주고 죽지 않는다", () => {
    (globalThis as { localStorage: Storage }).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(getBest("curve")).toBe(0);
    expect(recordBest("curve", 100)).toEqual({ best: 100, isNew: true }); // 저장 실패해도 이번 판은 반영
  });
});

describe("닉네임 기억 (B — prefs)", () => {
  beforeEach(() => {
    (globalThis as { localStorage: Storage }).localStorage = fakeStorage();
  });

  it("저장한 닉네임을 다음에 읽어온다", () => {
    expect(loadNickname()).toBe(""); // 처음엔 없음
    saveNickname("고수");
    expect(loadNickname()).toBe("고수");
  });

  it("localStorage가 막혀도 빈 문자열을 주고 죽지 않는다", () => {
    (globalThis as { localStorage: Storage }).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(loadNickname()).toBe("");
    expect(() => saveNickname("고수")).not.toThrow();
  });
});
