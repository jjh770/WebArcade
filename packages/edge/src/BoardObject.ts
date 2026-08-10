/* ============================================================
   BoardObject — 혼자 기록 랭킹 하나 = Durable Object 하나
   ------------------------------------------------------------
   방(RoomObject)이 코드마다 하나씩인 것과 달리, 보드는 **전 세계에 하나**다
   (`idFromName(BOARD_NAME)`). 순위표는 모두가 같은 목록을 봐야 의미가 있으니
   나뉘면 안 된다. 이 규모에서는 오브젝트 하나로 충분하다.

   서명 열쇠도 여기 있다. 티켓을 발급하는 것도, 검증하는 것도 이 오브젝트
   하나뿐이라 열쇠를 밖에 둘 이유가 없다 — 배포할 때 비밀값을 심는 절차가
   사라지고, 열쇠가 새어 나갈 표면도 없다. 첫 요청 때 무작위로 만들어
   스토리지에 넣고 계속 쓴다.

   ⚠️ 판정 규칙은 여기 없다. 시간 산수와 줄 세우기는 soloRules.ts의 순수
      함수이고, 이 클래스는 서명·저장·라우팅만 맡는다.
   ============================================================ */

import {
  BOARD_LIMIT,
  TICKET_TTL_MS,
  checkClaim,
  decodePayload,
  encodePayload,
  insertEntry,
  removeEntry,
  renameEntry,
  type BoardEntry,
  type TicketPayload,
} from "./soloRules";
import { isNickname } from "./validation";

/** 보드는 하나뿐이다. 이름을 바꾸면 기록이 통째로 새 오브젝트로 옮겨간다(=초기화). */
export const BOARD_NAME = "solo-v1";

const SECRET_KEY = "secret";
const BOARD_PREFIX = "board:";
const SPENT_PREFIX = "spent:";

/** 클라에 내려보내는 줄 수. 저장은 BOARD_LIMIT만큼 하되 화면에는 위만 보인다. */
const PAGE_SIZE = 20;

function badRequest(reason: string): Response {
  return Response.json({ reason }, { status: 400 });
}

export class BoardObject {
  /** HMAC 열쇠. 생성자에서 스토리지의 비밀값으로 만든다. */
  private key: CryptoKey | null = null;

  /** 마지막으로 만료된 일련번호를 쓸어낸 시각. 날아가도 한 번 더 쓸 뿐이라 저장하지 않는다. */
  private lastSweepAt = 0;

  constructor(private readonly ctx: DurableObjectState) {
    // 열쇠 없이 요청을 받으면 서명도 검증도 못 한다 — 먼저 준비되게 막아 둔다.
    ctx.blockConcurrencyWhile(async () => {
      let secret = await ctx.storage.get<Uint8Array>(SECRET_KEY);
      if (!secret) {
        secret = crypto.getRandomValues(new Uint8Array(32));
        await ctx.storage.put(SECRET_KEY, secret);
      }
      this.key = await crypto.subtle.importKey(
        "raw",
        secret,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ticket") return this.issueTicket(url.searchParams.get("gameId") ?? "");
    if (url.pathname === "/score") return this.submitScore(request);
    if (url.pathname === "/board") return this.readBoard(url.searchParams.get("gameId") ?? "");
    // 열쇠 확인은 여기까지 오기 전에 끝났다(index.ts) — 이 오브젝트는 브라우저와
    // 직접 말하지 않으므로, 스텁을 손에 쥔 쪽은 이미 통과한 요청뿐이다.
    if (url.pathname === "/remove") {
      return this.removeRow(url.searchParams.get("gameId") ?? "", url.searchParams.get("nickname") ?? "");
    }
    if (url.pathname === "/rename") {
      return this.renameRow(
        url.searchParams.get("gameId") ?? "",
        url.searchParams.get("from") ?? "",
        url.searchParams.get("to") ?? "",
      );
    }
    return new Response("Not Found", { status: 404 });
  }

  /** 랭킹 도전 한 판을 연다. 시드는 여기서 뽑아 티켓에 봉인한다 —
   *  클라가 시드를 고르면 "쉬운 판이 나올 때까지 다시 뽑기"가 되기 때문이다. */
  private async issueTicket(gameId: string): Promise<Response> {
    const payload: TicketPayload = {
      g: gameId,
      s: crypto.getRandomValues(new Uint32Array(1))[0]!,
      t: Date.now(),
      n: crypto.randomUUID(),
    };
    const encoded = encodePayload(payload);
    return Response.json({ ticket: `${encoded}.${await this.sign(encoded)}`, seed: payload.s });
  }

  private async submitScore(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("잘못된 요청 형식입니다.");
    }
    const { ticket, nickname, score } = (body ?? {}) as Record<string, unknown>;
    if (typeof ticket !== "string" || !isNickname(nickname)) {
      return badRequest("잘못된 요청 형식입니다.");
    }

    const payload = await this.verify(ticket);
    if (!payload) return badRequest("기록 티켓이 유효하지 않습니다.");

    const now = Date.now();
    const claim = checkClaim(payload, Number(score), now);
    if (!claim.ok) return badRequest(claim.reason);

    // 소진 표시가 먼저다. 같은 티켓으로 동시에 두 번 들어와도 DO는 요청을 하나씩
    // 처리하므로, 여기서 걸러지면 두 번째는 반드시 막힌다.
    const spentKey = SPENT_PREFIX + payload.n;
    if (await this.ctx.storage.get(spentKey)) {
      return badRequest("이미 등록된 기록입니다.");
    }
    await this.ctx.storage.put(spentKey, payload.t);

    const entry: BoardEntry = { nickname: String(nickname).trim(), score: Number(score), at: now };
    const stored = await this.load(payload.g);
    const result = insertEntry(stored, entry, BOARD_LIMIT);
    await this.ctx.storage.put(BOARD_PREFIX + payload.g, result.board);
    await this.sweep(now);

    return Response.json({
      rank: result.rank,
      best: result.best,
      isBest: result.isBest,
      total: result.board.length,
      entries: result.board.slice(0, PAGE_SIZE),
    });
  }

  /** 순위표에서 그 닉네임의 줄을 지운다. 없으면 removed: 0 — 오류가 아니다.
   *  (오타로 못 찾은 것과 이미 지운 것을 굳이 구분하지 않는다. 부르는 쪽이 숫자를 보고 판단한다.) */
  private async removeRow(gameId: string, nickname: string): Promise<Response> {
    // 저장할 때 trim한 이름으로 넣으므로(submitScore), 지울 때도 같은 모양으로 찾는다.
    const target = nickname.trim();
    if (!isNickname(target)) return badRequest("잘못된 요청 형식입니다.");

    const result = removeEntry(await this.load(gameId), target);
    if (result.removed > 0) await this.ctx.storage.put(BOARD_PREFIX + gameId, result.board);
    return Response.json({
      removed: result.removed,
      total: result.board.length,
      entries: result.board.slice(0, PAGE_SIZE),
    });
  }

  /** 한 줄의 이름을 바꾼다. 못 찾거나 이름이 겹치면 409 — 아무것도 건드리지 않는다. */
  private async renameRow(gameId: string, from: string, to: string): Promise<Response> {
    const [before, after] = [from.trim(), to.trim()];
    // 바꾼 뒤 이름도 플레이어가 쓸 수 있는 이름이어야 한다 — 운영자라고 규칙 밖으로 나가면
    // 순위표에 대기실에서는 만들 수 없는 이름이 생긴다.
    if (!isNickname(before) || !isNickname(after)) return badRequest("잘못된 요청 형식입니다.");

    const result = renameEntry(await this.load(gameId), before, after);
    if (!result.ok) return Response.json({ reason: result.reason }, { status: 409 });

    await this.ctx.storage.put(BOARD_PREFIX + gameId, result.board);
    return Response.json({ total: result.board.length, entries: result.board.slice(0, PAGE_SIZE) });
  }

  private async readBoard(gameId: string): Promise<Response> {
    const board = await this.load(gameId);
    return Response.json({ total: board.length, entries: board.slice(0, PAGE_SIZE) });
  }

  /** 저장된 보드를 읽는다. **옛 모양을 여기서 한 번 갈아 끼운다.**
   *
   *  기록 칸의 이름이 `ticks`였다가 `score`가 됐다. 이미 저장된 줄들은 옛 이름을 달고
   *  있으므로, 그대로 읽으면 기록이 통째로 undefined가 되어 순위표가 무너진다.
   *  읽는 자리가 여기 하나뿐이라 여기서만 옮겨 주면 된다 — 다음 쓰기에서 새 이름으로
   *  저장되므로 시간이 지나면 옛 줄은 저절로 없어진다. 따로 마이그레이션을 돌리지
   *  않는 이유다(읽기만 되는 보드는 계속 이 자리에서 변환된다 — 값은 언제나 맞다). */
  private async load(gameId: string): Promise<BoardEntry[]> {
    const stored = await this.ctx.storage.get<(BoardEntry & { ticks?: number })[]>(BOARD_PREFIX + gameId);
    if (!stored) return [];
    return stored.map((row) =>
      row.score === undefined
        ? { nickname: row.nickname, score: row.ticks ?? 0, at: row.at }
        : row,
    );
  }

  private async sign(encoded: string): Promise<string> {
    const signature = await crypto.subtle.sign("HMAC", this.key!, new TextEncoder().encode(encoded));
    return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  /** 서명이 맞는 티켓만 내용을 돌려준다. 형식이 조금이라도 어긋나면 null. */
  private async verify(ticket: string): Promise<TicketPayload | null> {
    const dot = ticket.lastIndexOf(".");
    if (dot <= 0) return null;
    const encoded = ticket.slice(0, dot);
    const hex = ticket.slice(dot + 1);
    if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) return null;

    const signature = new Uint8Array(hex.length / 2);
    for (let i = 0; i < signature.length; i++) signature[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const valid = await crypto.subtle.verify(
      "HMAC",
      this.key!,
      signature,
      new TextEncoder().encode(encoded),
    );
    return valid ? decodePayload(encoded) : null;
  }

  /** 만료된 일련번호를 치운다. 티켓 유효기간이 지나면 어차피 거부되므로 보관할 이유가 없다.
   *  알람을 걸지 않는 건 이 오브젝트를 깨워 둘 이유가 없어서다 — 제출이 들어온 김에 쓴다. */
  private async sweep(now: number): Promise<void> {
    if (now - this.lastSweepAt < TICKET_TTL_MS) return;
    this.lastSweepAt = now;
    const spent = await this.ctx.storage.list<number>({ prefix: SPENT_PREFIX });
    const stale = [...spent].filter(([, issuedAt]) => now - issuedAt > TICKET_TTL_MS).map(([key]) => key);
    if (stale.length > 0) await this.ctx.storage.delete(stale);
  }
}
