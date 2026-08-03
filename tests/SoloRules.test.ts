/* ============================================================
   혼자 기록 판정 규칙 — 순수 함수라 Node에서 돈다
   ------------------------------------------------------------
   서명·저장·라우팅(BoardObject)은 workerd가 필요해 packages/edge/test에서
   따로 확인한다. 여기서는 시간 산수와 줄 세우기만 본다.
   ============================================================ */

import { describe, expect, it } from "vitest";
import {
  BOARD_LIMIT,
  CLAIM_TOLERANCE_MS,
  TICKET_TTL_MS,
  checkClaim,
  decodePayload,
  encodePayload,
  insertEntry,
  type BoardEntry,
  type TicketPayload,
} from "../packages/edge/src/soloRules";

const TICKET: TicketPayload = { g: "jungnim", s: 12345, t: 1_000_000, n: "nonce-1" };

describe("티켓 인코딩", () => {
  it("담은 내용이 그대로 돌아온다", () => {
    expect(decodePayload(encodePayload(TICKET))).toEqual(TICKET);
  });

  it("URL·본문에 그냥 실을 수 있는 문자만 쓴다", () => {
    expect(encodePayload(TICKET)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("깨진 문자열은 null", () => {
    expect(decodePayload("not-a-ticket!!")).toBeNull();
    expect(decodePayload("")).toBeNull();
  });

  it("모양만 맞고 내용이 빠진 것도 null", () => {
    const partial = btoa(JSON.stringify({ g: "jungnim" })).replace(/=+$/, "");
    expect(decodePayload(partial)).toBeNull();
  });
});

describe("기록 신고 검사", () => {
  const now = TICKET.t + 60_000; // 발급 1분 뒤

  it("흐른 시간 안에 들어오는 기록은 통과", () => {
    expect(checkClaim(TICKET, 60 * 30, now)).toEqual({ ok: true }); // 30초
  });

  it("흐른 시간보다 오래 버텼다는 신고는 거부", () => {
    // 1분밖에 안 지났는데 2분을 버텼다는 주장.
    expect(checkClaim(TICKET, 60 * 120, now).ok).toBe(false);
  });

  it("여유 폭 안쪽은 봐준다 — 시계 오차로 아슬아슬하게 넘칠 수 있다", () => {
    const ticks = Math.floor(((60_000 + CLAIM_TOLERANCE_MS - 100) / 1000) * 60);
    expect(checkClaim(TICKET, ticks, now).ok).toBe(true);
  });

  it("유효기간이 지난 티켓은 거부", () => {
    expect(checkClaim(TICKET, 60, TICKET.t + TICKET_TTL_MS + 1).ok).toBe(false);
  });

  it("발급보다 이른 시각의 신고는 거부", () => {
    expect(checkClaim(TICKET, 60, TICKET.t - 1).ok).toBe(false);
  });

  it("정수가 아니거나 음수인 기록은 거부", () => {
    expect(checkClaim(TICKET, -1, now).ok).toBe(false);
    expect(checkClaim(TICKET, 1.5, now).ok).toBe(false);
    expect(checkClaim(TICKET, Number.NaN, now).ok).toBe(false);
  });
});

const entry = (nickname: string, ticks: number, at: number): BoardEntry => ({ nickname, ticks, at });

describe("보드 줄 세우기", () => {
  it("오래 버틴 순서로 선다", () => {
    let board: BoardEntry[] = [];
    for (const [name, ticks] of [["가", 100], ["나", 300], ["다", 200]] as const) {
      board = insertEntry(board, entry(name, ticks, 1)).board;
    }
    expect(board.map((row) => row.nickname)).toEqual(["나", "다", "가"]);
  });

  it("동점이면 먼저 세운 기록이 위다", () => {
    const board = insertEntry([entry("먼저", 100, 10)], entry("나중", 100, 20)).board;
    expect(board.map((row) => row.nickname)).toEqual(["먼저", "나중"]);
  });

  it("같은 닉네임은 최고 기록 한 줄만 남는다", () => {
    let board = insertEntry([], entry("가", 100, 1)).board;
    board = insertEntry(board, entry("가", 300, 2)).board;
    expect(board).toEqual([entry("가", 300, 2)]);
  });

  it("예전 기록보다 나쁘면 보드는 그대로고 isBest가 false다", () => {
    const result = insertEntry([entry("가", 300, 1)], entry("가", 100, 2));
    expect(result.board).toEqual([entry("가", 300, 1)]);
    expect(result.isBest).toBe(false);
    expect(result.best).toBe(300);
    expect(result.rank).toBe(1);
  });

  it("등수와 최고 기록을 함께 돌려준다", () => {
    const board = [entry("가", 300, 1), entry("나", 200, 1)];
    const result = insertEntry(board, entry("다", 250, 2));
    expect(result.rank).toBe(2);
    expect(result.best).toBe(250);
    expect(result.isBest).toBe(true);
  });

  it("상한을 넘으면 아래부터 버리고, 밀려난 기록은 등수가 없다", () => {
    const full = Array.from({ length: BOARD_LIMIT }, (_, index) =>
      entry(`p${index}`, 1000 - index, 1),
    );
    const result = insertEntry(full, entry("꼴찌", 1, 2));
    expect(result.board).toHaveLength(BOARD_LIMIT);
    expect(result.rank).toBeNull();
    expect(result.board.some((row) => row.nickname === "꼴찌")).toBe(false);
  });
});
