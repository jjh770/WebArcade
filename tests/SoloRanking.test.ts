/* 혼자 기록 제출 클라이언트 — 서버가 없거나 거부할 때 **조용히 null**이 되는지가
   핵심이다. 여기가 던지면 연습 자체가 막힌다(서버 없이도 놀 수 있어야 한다).

   서버 주소는 import.meta.env에서 오므로 모듈을 불러오기 전에 심는다. */
import { beforeEach, describe, expect, it, vi } from "vitest";

// 계약상 readonly(빌드 타임에 박히는 값)라 캐스트로 넘긴다 — 시험에서만 심는다.
(import.meta.env as { VITE_WS_URL?: string }).VITE_WS_URL = "ws://server.test:8787";
const { takeTicket, submitScore, fetchBoard } = await import("../packages/app/src/soloRanking");

type Call = { url: string; init: RequestInit };

/** fetch 대역. 응답을 정해주고, 무엇을 어떻게 불렀는지 남긴다. */
function stubFetch(respond: (call: Call) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const result = respond({ url: String(url), init });
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result as Response);
  });
  return calls;
}

const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;
const rejected = (): Response =>
  ({ ok: false, status: 400, json: () => Promise.resolve({ reason: "거부" }) }) as Response;

describe("티켓 받기", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("서버가 준 시드와 티켓을 그대로 돌려준다", async () => {
    const calls = stubFetch(() => ok({ ticket: "abc.def", seed: 42 }));
    expect(await takeTicket("jungnim")).toEqual({ ticket: "abc.def", seed: 42 });
    expect(calls[0]!.url).toBe("http://server.test:8787/solo/ticket?gameId=jungnim");
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("ws 주소를 http로 바꿔 부른다 — 설정은 하나뿐이다", async () => {
    const calls = stubFetch(() => ok({ ticket: "a.b", seed: 1 }));
    await takeTicket("curve");
    expect(calls[0]!.url.startsWith("http://")).toBe(true);
  });

  it("서버가 없으면 null — 던지지 않는다(연습이 막히면 안 된다)", async () => {
    stubFetch(() => new Error("연결 실패"));
    await expect(takeTicket("jungnim")).resolves.toBeNull();
  });

  it("서버가 거부해도 null", async () => {
    stubFetch(() => rejected());
    expect(await takeTicket("jungnim")).toBeNull();
  });

  it("기다리다 끊어져도 null", async () => {
    stubFetch(() => Object.assign(new Error("시간 초과"), { name: "TimeoutError" }));
    expect(await takeTicket("jungnim")).toBeNull();
  });
});

describe("기록 내기", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("티켓·닉네임·기록을 JSON으로 보낸다", async () => {
    const calls = stubFetch(() => ok({ rank: 3, best: 900, isBest: true, total: 7, entries: [] }));
    const result = await submitScore("abc.def", "나그네", 900);

    expect(result).toEqual({ rank: 3, best: 900, isBest: true, total: 7, entries: [] });
    expect(calls[0]!.url).toBe("http://server.test:8787/solo/score");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      ticket: "abc.def",
      nickname: "나그네",
      score: 900,
    });
    // content-type이 빠지면 서버가 본문을 JSON으로 읽지 못한다.
    expect(calls[0]!.init.headers).toEqual({ "content-type": "application/json" });
  });

  it("순위표는 줄 목록만 꺼내 준다", async () => {
    const rows = [{ nickname: "가", score: 900, at: 1 }];
    const calls = stubFetch(() => ok({ total: 1, entries: rows }));
    expect(await fetchBoard("floor")).toEqual(rows);
    expect(calls[0]!.url).toBe("http://server.test:8787/solo/board?gameId=floor");
  });

  it("순위표를 못 불러오면 null — 빈 목록과 구분된다", async () => {
    // 화면이 "아직 기록 없음"과 "못 불러옴"을 다르게 말해야 하므로 섞으면 안 된다.
    stubFetch(() => new Error("연결 실패"));
    expect(await fetchBoard("floor")).toBeNull();
    vi.unstubAllGlobals();
    stubFetch(() => ok({ total: 0, entries: [] }));
    expect(await fetchBoard("floor")).toEqual([]);
  });

  it("0점은 아예 보내지 않는다 — 아무것도 안 한 판은 기록이 아니다", async () => {
    // 순위표는 닉네임당 한 줄이라, 0점짜리가 남으면 이름만 차지한다.
    const calls = stubFetch(() => ok({ rank: 1, best: 0, isBest: true, total: 1, entries: [] }));
    expect(await submitScore("abc.def", "나그네", 0)).toBeNull();
    expect(await submitScore("abc.def", "나그네", -5)).toBeNull();
    expect(calls).toHaveLength(0); // 서버를 부르지도 않았다
    // 1점부터는 기록이다.
    expect(await submitScore("abc.def", "나그네", 1)).not.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("거부·불통은 모두 null — 결과창은 등수 없이 그대로 뜬다", async () => {
    stubFetch(() => rejected());
    expect(await submitScore("abc.def", "나그네", 900)).toBeNull();
    vi.unstubAllGlobals();
    stubFetch(() => new Error("연결 실패"));
    expect(await submitScore("abc.def", "나그네", 900)).toBeNull();
  });
});
