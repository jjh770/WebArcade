/* 소리 — Node엔 WebAudio가 없으니 가짜 AudioContext를 심어 "무엇을 예약했는가"를
   본다. 실제로 울리는 소리는 검증할 수 없지만, 이 계층에서 틀릴 수 있는 건
   전부 스케줄 결정이다: 껐는데 울리는가, 봉투가 0을 밟는가(지수 램프가 죽는다),
   잠든 컨텍스트를 깨우는가, 목소리가 무한정 쌓이는가, 오디오가 없는 환경에서
   던지는가. */
import { beforeEach, describe, expect, it } from "vitest";
import { initAudio, isMuted, play, resetAudioForTest, setMuted, SOUND_IDS } from "../packages/app/src/audio";

type GainCall = [kind: string, value: number, at: number];

class FakeParam {
  value = 0;
  readonly calls: GainCall[] = [];
  setValueAtTime(v: number, at: number) {
    this.calls.push(["set", v, at]);
  }
  linearRampToValueAtTime(v: number, at: number) {
    this.calls.push(["linear", v, at]);
  }
  exponentialRampToValueAtTime(v: number, at: number) {
    this.calls.push(["exp", v, at]);
  }
}

class FakeGain {
  readonly gain = new FakeParam();
  connectedTo: unknown = null;
  disconnected = false;
  connect(target: unknown) {
    this.connectedTo = target;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeOsc {
  type = "";
  readonly frequency = new FakeParam();
  onended: (() => void) | null = null;
  startedAt = -1;
  stoppedAt = -1;
  connectedTo: unknown = null;
  connect(target: unknown) {
    this.connectedTo = target;
  }
  disconnect() {}
  start(at: number) {
    this.startedAt = at;
  }
  stop(at: number) {
    this.stoppedAt = at;
  }
  /** 브라우저라면 재생이 끝났을 때 오는 콜백을 손으로 흉내 낸다. */
  finish() {
    this.onended?.();
  }
}

class FakeContext {
  static last: FakeContext | null = null;
  currentTime = 10;
  state: AudioContextState = "running";
  readonly destination = { id: "destination" };
  readonly gains: FakeGain[] = [];
  readonly oscillators: FakeOsc[] = [];
  resumed = 0;
  constructor() {
    FakeContext.last = this;
  }
  resume() {
    this.resumed += 1;
    this.state = "running";
    return Promise.resolve();
  }
  createGain() {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeOsc();
    this.oscillators.push(node);
    return node;
  }
}

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

type Globals = { AudioContext?: unknown; localStorage: Storage };

function installAudio(): void {
  (globalThis as unknown as Globals).AudioContext = FakeContext;
}

/** 첫 소리를 낸 컨텍스트. play()가 게을리 만들기 때문에 재생 뒤에만 존재한다. */
function ctx(): FakeContext {
  expect(FakeContext.last).not.toBeNull();
  return FakeContext.last!;
}

describe("소리 — 재생 스케줄", () => {
  beforeEach(() => {
    resetAudioForTest();
    FakeContext.last = null;
    (globalThis as unknown as Globals).localStorage = fakeStorage();
    installAudio();
  });

  it("한 번 재생하면 오실레이터가 마스터를 거쳐 스피커까지 이어진다", () => {
    play("click");
    const audio = ctx();
    expect(audio.oscillators).toHaveLength(1);
    const [master, env] = audio.gains; // 첫 게인이 마스터, 그다음이 이 소리의 봉투
    expect(master.connectedTo).toBe(audio.destination);
    expect(audio.oscillators[0].connectedTo).toBe(env);
    expect(env.connectedTo).toBe(master);
  });

  it("컨텍스트는 재생 전에는 만들지 않는다 — 자동재생 정책 때문에 제스처 안에서 만들어야 한다", () => {
    expect(FakeContext.last).toBeNull();
    play("click");
    expect(FakeContext.last).not.toBeNull();
  });

  it("두 번째 재생은 컨텍스트를 새로 만들지 않는다", () => {
    play("click");
    const first = ctx();
    play("click");
    expect(ctx()).toBe(first);
    expect(first.oscillators).toHaveLength(2);
  });

  it("봉투는 0을 밟지 않는다 — 지수 램프는 0에 닿을 수 없어 소리가 끊긴다", () => {
    play("click");
    const env = ctx().gains[1];
    for (const [, value] of env.gain.calls) expect(value).toBeGreaterThan(0);
    const kinds = env.gain.calls.map(([kind]) => kind);
    expect(kinds).toEqual(["set", "linear", "exp"]); // 하한 → 최대 → 하한
    const peak = env.gain.calls[1][1];
    expect(peak).toBeGreaterThan(env.gain.calls[0][1]);
    expect(peak).toBeGreaterThan(env.gain.calls[2][1]);
  });

  it("예약 시각은 현재 시각 이후이고 stop이 start보다 뒤다", () => {
    play("click");
    const audio = ctx();
    const osc = audio.oscillators[0];
    expect(osc.startedAt).toBeGreaterThanOrEqual(audio.currentTime);
    expect(osc.stoppedAt).toBeGreaterThan(osc.startedAt);
  });

  it("잠든 컨텍스트는 재생할 때 깨운다", () => {
    play("click");
    const audio = ctx();
    audio.state = "suspended"; // 탭을 옮겼다 돌아온 상황
    play("click");
    expect(audio.resumed).toBe(1);
    expect(audio.oscillators).toHaveLength(2);
  });
});

describe("소리 — 표 전체", () => {
  beforeEach(() => {
    resetAudioForTest();
    FakeContext.last = null;
    (globalThis as unknown as Globals).localStorage = fakeStorage();
    installAudio();
  });

  it("표에 있는 모든 소리가 실제로 울린다 — 음 수가 동시 발음 한도를 넘으면 영원히 안 난다", () => {
    expect(SOUND_IDS.length).toBeGreaterThan(0);
    for (const id of SOUND_IDS) {
      resetAudioForTest(); // 앞 소리가 자리를 차지한 채로 재지 않는다
      FakeContext.last = null;
      play(id);
      expect(ctx().oscillators.length, `${id}가 소리를 내지 않았다`).toBeGreaterThan(0);
    }
  });

  it("여러 음짜리 소리는 음마다 시각을 밀어 또박또박 끊어 낸다", () => {
    play("result"); // 올라가는 아르페지오
    const oscs = ctx().oscillators;
    expect(oscs.length).toBeGreaterThan(1);
    for (let i = 1; i < oscs.length; i++) {
      expect(oscs[i].startedAt).toBeGreaterThan(oscs[i - 1].startedAt);
      // 앞 음은 다음 음이 시작할 때까지 끝난다 — 겹치면 화음이 되어 결이 달라진다.
      expect(oscs[i - 1].stoppedAt).toBeLessThanOrEqual(oscs[i].startedAt + 1e-9);
    }
  });

  it("음정은 소리마다 다르다 — 카운트다운과 시작이 같은 소리면 구분이 안 된다", () => {
    const pitchOf = (id: (typeof SOUND_IDS)[number]) => {
      resetAudioForTest();
      FakeContext.last = null;
      play(id);
      return ctx().oscillators.map((o) => o.frequency.calls[0][1]);
    };
    const signatures = SOUND_IDS.map((id) => pitchOf(id).join(","));
    expect(new Set(signatures).size).toBe(SOUND_IDS.length);
  });
});

describe("소리 — 동시 발음 제한", () => {
  beforeEach(() => {
    resetAudioForTest();
    FakeContext.last = null;
    (globalThis as unknown as Globals).localStorage = fakeStorage();
    installAudio();
  });

  it("한도를 넘으면 새 소리를 버리고, 끝난 소리가 자리를 비우면 다시 난다", () => {
    for (let i = 0; i < 8; i++) play("click");
    const audio = ctx();
    expect(audio.oscillators).toHaveLength(8);

    play("click"); // 9번째 — 자리가 없다
    expect(audio.oscillators).toHaveLength(8);

    audio.oscillators[0].finish(); // 하나가 끝났다
    play("click");
    expect(audio.oscillators).toHaveLength(9);
  });

  it("끝난 소리는 그래프에서 떨어져 나간다", () => {
    play("click");
    const audio = ctx();
    audio.oscillators[0].finish();
    expect(audio.gains[1].disconnected).toBe(true);
  });
});

describe("소리 — 끄기와 기억", () => {
  beforeEach(() => {
    resetAudioForTest();
    FakeContext.last = null;
    (globalThis as unknown as Globals).localStorage = fakeStorage();
    installAudio();
  });

  it("꺼 두면 컨텍스트조차 만들지 않는다", () => {
    setMuted(true);
    play("click");
    expect(FakeContext.last).toBeNull();
  });

  it("껐다 켜면 다시 난다", () => {
    setMuted(true);
    play("click");
    setMuted(false);
    play("click");
    expect(ctx().oscillators).toHaveLength(1);
  });

  it("끈 설정은 다음 방문에도 남는다", () => {
    setMuted(true);
    resetAudioForTest(); // 페이지를 새로 연 셈 (localStorage는 그대로)
    expect(isMuted()).toBe(false); // initAudio 전에는 기본값
    initAudio();
    expect(isMuted()).toBe(true);
  });

  it("저장된 설정이 없으면 소리는 켜져 있다", () => {
    initAudio();
    expect(isMuted()).toBe(false);
  });

  it("localStorage가 막혀도 던지지 않는다", () => {
    (globalThis as unknown as Globals).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() => initAudio()).not.toThrow();
    expect(() => setMuted(true)).not.toThrow();
    expect(isMuted()).toBe(true); // 저장은 실패해도 이번 세션엔 반영된다
  });
});

describe("소리 — 없는 환경", () => {
  beforeEach(() => {
    resetAudioForTest();
    FakeContext.last = null;
    (globalThis as unknown as Globals).localStorage = fakeStorage();
  });

  it("AudioContext가 없으면 조용히 넘어간다", () => {
    delete (globalThis as unknown as Globals).AudioContext;
    expect(() => play("click")).not.toThrow();
  });

  it("컨텍스트 생성이 던져도 조용히 넘어간다", () => {
    (globalThis as unknown as Globals).AudioContext = function Broken() {
      throw new Error("no audio device");
    };
    expect(() => play("click")).not.toThrow();
  });
});
