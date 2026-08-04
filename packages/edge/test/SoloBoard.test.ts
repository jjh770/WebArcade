/* ============================================================
   혼자 기록 랭킹 — 실제 Workers 런타임에서 배선을 확인한다
   ------------------------------------------------------------
   판정 규칙 자체(시간 산수·줄 세우기)는 tests/SoloRules.test.ts가 Node에서
   본다. 여기서 확인하는 건 모킹하면 사라지는 것들이다 — 진짜 HMAC 서명,
   오브젝트 스토리지에 남는 일련번호, 게임별로 갈린 보드.
   ============================================================ */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

type Ticket = { ticket: string; seed: number };
type Submitted = {
  rank: number | null;
  best: number;
  isBest: boolean;
  total: number;
  entries: { nickname: string; ticks: number; at: number }[];
  reason?: string;
};

async function takeTicket(gameId = "jungnim"): Promise<Ticket> {
  const response = await SELF.fetch(`https://test/solo/ticket?gameId=${gameId}`, { method: "POST" });
  expect(response.status).toBe(200);
  return (await response.json()) as Ticket;
}

async function submit(ticket: string, nickname: string, ticks: number) {
  const response = await SELF.fetch("https://test/solo/score", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket, nickname, ticks }),
  });
  return { status: response.status, body: (await response.json()) as Submitted };
}

async function readBoard(gameId = "jungnim"): Promise<Submitted> {
  const response = await SELF.fetch(`https://test/solo/board?gameId=${gameId}`);
  return (await response.json()) as Submitted;
}

describe("티켓 발급", () => {
  it("게임마다 시드와 서명된 티켓을 준다", async () => {
    const { ticket, seed } = await takeTicket();
    expect(Number.isInteger(seed)).toBe(true);
    // <내용>.<서명 hex> 두 토막.
    expect(ticket).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
  });

  it("발급할 때마다 다른 시드가 나온다 — 같은 판을 반복해 외울 수 없다", async () => {
    const [first, second] = [await takeTicket(), await takeTicket()];
    expect(first.seed).not.toBe(second.seed);
    expect(first.ticket).not.toBe(second.ticket);
  });

  it("형식이 아닌 게임 id는 거부한다", async () => {
    const response = await SELF.fetch("https://test/solo/ticket?gameId=%20%2F%2Fbad", { method: "POST" });
    expect(response.status).toBe(400);
  });
});

describe("기록 제출", () => {
  it("정상 기록은 보드에 남고 등수를 돌려준다", async () => {
    const { ticket } = await takeTicket();
    const { status, body } = await submit(ticket, "정상", 30);
    expect(status).toBe(200);
    expect(body.rank).toBe(1);
    expect(body.isBest).toBe(true);

    const board = await readBoard();
    expect(board.entries.map((row) => row.nickname)).toContain("정상");
  });

  it("같은 티켓으로 두 번은 못 낸다", async () => {
    const { ticket } = await takeTicket();
    expect((await submit(ticket, "재사용", 30)).status).toBe(200);
    const second = await submit(ticket, "재사용", 30);
    expect(second.status).toBe(400);
    expect(second.body.reason).toContain("이미 등록된");
  });

  it("내용을 고친 티켓은 서명에서 걸린다", async () => {
    const { ticket } = await takeTicket();
    const [encoded, signature] = ticket.split(".");
    const payload = JSON.parse(atob(encoded!.replace(/-/g, "+").replace(/_/g, "/")));
    // 발급 시각을 한참 전으로 당기면 아무리 긴 생존시간도 통과한다 — 서명이 없다면.
    payload.t -= 10 * 60_000;
    const forged = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const result = await submit(`${forged}.${signature}`, "위조", 60 * 300);
    expect(result.status).toBe(400);
    expect(result.body.reason).toContain("유효하지 않습니다");
  });

  it("흐른 시간보다 오래 버텼다는 신고는 거부한다", async () => {
    const { ticket } = await takeTicket();
    const result = await submit(ticket, "과장", 60 * 300); // 방금 받은 티켓으로 5분 생존 주장
    expect(result.status).toBe(400);
    expect(result.body.reason).toContain("생존시간");
  });

  it("닉네임 규칙은 대기실과 같다", async () => {
    const { ticket } = await takeTicket();
    expect((await submit(ticket, "   ", 30)).status).toBe(400);
    expect((await submit(ticket, "열두글자를넘어서는아주긴이름", 30)).status).toBe(400); // 14자
    expect((await submit(ticket, "열두글자까지는통과합니다", 30)).status).toBe(200); // 12자 — 경계는 통과
  });

  it("거부된 기록은 티켓을 태우지 않는다 — 다시 낼 수 있다", async () => {
    const { ticket } = await takeTicket();
    expect((await submit(ticket, "재도전", 60 * 300)).status).toBe(400);
    expect((await submit(ticket, "재도전", 30)).status).toBe(200);
  });
});

// ⚠️ 이 파일의 테스트들은 **같은 보드 오브젝트**를 공유한다(스토리지가 테스트마다
//    초기화되지 않는다). 그래서 "보드에 이것만 있다"고 단정하지 말고 닉네임을
//    테스트마다 다르게 써서 들어있음/없음으로 확인한다.
describe("보드", () => {
  it("게임마다 따로 쌓인다", async () => {
    const jungnim = await takeTicket("jungnim");
    const floor = await takeTicket("floor");
    await submit(jungnim.ticket, "죽림사람", 30);
    await submit(floor.ticket, "바닥사람", 30);

    const names = {
      jungnim: (await readBoard("jungnim")).entries.map((row) => row.nickname),
      floor: (await readBoard("floor")).entries.map((row) => row.nickname),
    };
    expect(names.jungnim).toContain("죽림사람");
    expect(names.jungnim).not.toContain("바닥사람");
    expect(names.floor).toEqual(["바닥사람"]);
  });

  it("기록이 없는 게임은 빈 목록이다", async () => {
    expect(await readBoard("curve")).toEqual({ total: 0, entries: [] });
  });

  it("브라우저가 읽을 수 있게 CORS 헤더가 붙는다", async () => {
    const response = await SELF.fetch("https://test/solo/board?gameId=jungnim");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});

// 열쇠 자체를 가리는 규칙은 tests/SoloRules.test.ts(isAdmin)가 본다. 여기서는
// 그 판단이 실제 경로에 붙어 있는지와, 통과했을 때 스토리지에서 정말 빠지는지를 본다.
describe("기록 지우기(운영자)", () => {
  const KEY = "test-admin-key"; // vitest.config.ts의 시험용 바인딩과 같아야 한다.

  async function remove(gameId: string, nickname: string, key = KEY) {
    const query = `gameId=${gameId}&nickname=${encodeURIComponent(nickname)}`;
    return SELF.fetch(`https://test/solo/entry?${query}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${key}` },
    });
  }

  it("열쇠가 맞으면 보드에서 빠진다", async () => {
    const { ticket } = await takeTicket();
    await submit(ticket, "지워질사람", 30);
    expect((await readBoard()).entries.map((row) => row.nickname)).toContain("지워질사람");

    const response = await remove("jungnim", "지워질사람");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { removed: number }).removed).toBe(1);
    expect((await readBoard()).entries.map((row) => row.nickname)).not.toContain("지워질사람");
  });

  it("열쇠가 틀리면 404 — 경로가 있다는 것조차 알려주지 않는다", async () => {
    const { ticket } = await takeTicket();
    await submit(ticket, "남을사람", 30);

    expect((await remove("jungnim", "남을사람", "wrong-key")).status).toBe(404);
    expect((await readBoard()).entries.map((row) => row.nickname)).toContain("남을사람");
  });

  it("열쇠 없이 DELETE만 던져도 404다", async () => {
    const response = await SELF.fetch("https://test/solo/entry?gameId=jungnim&nickname=아무개", {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });

  it("없는 이름은 removed: 0으로 조용히 끝난다", async () => {
    const response = await remove("jungnim", "그런사람없음");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { removed: number }).removed).toBe(0);
  });

  it("이름 바꾸기도 같은 열쇠로 잠긴다", async () => {
    const { ticket } = await takeTicket();
    await submit(ticket, "이름바꿀사람", 30);

    const rename = (key: string) => {
      const query = `gameId=jungnim&from=${encodeURIComponent("이름바꿀사람")}&to=${encodeURIComponent("바뀐이름")}`;
      return SELF.fetch(`https://test/solo/entry?${query}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${key}` },
      });
    };
    expect((await rename("wrong-key")).status).toBe(404);
    expect((await rename(KEY)).status).toBe(200);

    const names = (await readBoard()).entries.map((row) => row.nickname);
    expect(names).toContain("바뀐이름");
    expect(names).not.toContain("이름바꿀사람");
  });

  it("게임을 건너뛰지 않는다 — 다른 게임 보드는 그대로다", async () => {
    const jungnim = await takeTicket("jungnim");
    const floor = await takeTicket("floor");
    await submit(jungnim.ticket, "양쪽이름", 30);
    await submit(floor.ticket, "양쪽이름", 30);

    await remove("jungnim", "양쪽이름");
    expect((await readBoard("jungnim")).entries.map((row) => row.nickname)).not.toContain("양쪽이름");
    expect((await readBoard("floor")).entries.map((row) => row.nickname)).toContain("양쪽이름");
  });
});
