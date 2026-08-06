/* 로컬 설정 — 소리 스위치의 저장과 **옛 값의 승계**.

   배경음악이 생기며 소리 스위치가 하나에서 둘(효과음·음악)로 갈렸다. 그 순간
   이미 "소리 꺼짐"으로 저장해 두고 떠난 사람들이 있다. 그 사람이 다시 왔을 때
   음악이 울리기 시작하면, 껐던 설정을 우리가 무시한 것이 된다.

   여기서 못 박는 것은 그 승계다. 새 열쇠가 없으면 옛 열쇠를 본다. */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VOLUME,
  loadMusicMuted,
  loadSfxMuted,
  loadVolume,
  saveMusicMuted,
  saveSfxMuted,
  saveVolume,
} from "../packages/app/src/prefs";

const OLD_KEY = "arcade:muted";

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

function useStorage(seed?: Record<string, string>): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = fakeStorage(seed);
}

describe("소리 설정 저장", () => {
  beforeEach(() => useStorage());

  it("기본은 둘 다 켜짐 — 아케이드는 소리가 있는 쪽이 기본이다", () => {
    expect(loadSfxMuted()).toBe(false);
    expect(loadMusicMuted()).toBe(false);
  });

  it("따로 저장되고 따로 읽힌다 — 음악만 끄고 게임 소리는 듣는 사람", () => {
    saveMusicMuted(true);
    saveSfxMuted(false);
    expect(loadMusicMuted()).toBe(true);
    expect(loadSfxMuted()).toBe(false);
  });
});

describe("음량", () => {
  beforeEach(() => useStorage());

  it("손대지 않았으면 한가운데", () => {
    for (const kind of ["lobby", "game", "sfx"] as const) {
      expect(loadVolume(kind)).toBe(DEFAULT_VOLUME);
    }
  });

  it("갈래마다 따로 기억한다 — 판에서는 낮추고 로비에서는 키우는 사람", () => {
    saveVolume("game", 0.2);
    saveVolume("lobby", 0.9);
    saveVolume("sfx", 0.7);
    expect(loadVolume("game")).toBe(0.2);
    expect(loadVolume("lobby")).toBe(0.9);
    expect(loadVolume("sfx")).toBe(0.7);
  });

  /* 저장된 값은 사람이 손으로 고칠 수 있는 자리에 있다(localStorage). 거기서 온
     값을 그대로 믿고 게인에 걸면 귀가 다친다 — 읽는 쪽에서 가둔다. */
  it("범위를 벗어난 값은 0~1 안으로 가둔다", () => {
    saveVolume("sfx", 5);
    expect(loadVolume("sfx")).toBe(1);
    saveVolume("sfx", -3);
    expect(loadVolume("sfx")).toBe(0);
  });

  it("숫자가 아니면 기본값으로 돌아간다", () => {
    useStorage({ "arcade:vol:sfx": "시끄럽게" });
    expect(loadVolume("sfx")).toBe(DEFAULT_VOLUME);
  });

  it("0은 유효한 값이다 — 기본값으로 되돌리지 않는다", () => {
    saveVolume("lobby", 0);
    expect(loadVolume("lobby")).toBe(0);
  });
});

describe("옛 설정 승계", () => {
  it("소리를 꺼 뒀던 사람에게는 음악도 꺼진 채로 시작한다", () => {
    useStorage({ [OLD_KEY]: "1" });
    expect(loadSfxMuted()).toBe(true);
    expect(loadMusicMuted()).toBe(true);
  });

  it("켜 뒀던 사람은 그대로 켜짐", () => {
    useStorage({ [OLD_KEY]: "0" });
    expect(loadSfxMuted()).toBe(false);
    expect(loadMusicMuted()).toBe(false);
  });

  it("한쪽을 새로 정하면 그때부터 옛 값은 그 스위치에 영향을 주지 않는다", () => {
    useStorage({ [OLD_KEY]: "1" });
    saveMusicMuted(false); // 음악만 다시 켰다
    expect(loadMusicMuted()).toBe(false);
    expect(loadSfxMuted()).toBe(true); // 효과음은 아직 옛 값을 따른다
  });
});
