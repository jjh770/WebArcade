/* ============================================================
   서버 전송 계층 통합 테스트 — 실제 Workers 런타임(workerd) 안에서 돈다
   ------------------------------------------------------------
   Node로 흉내 내지 않는 이유: Durable Object의 라우팅·스토리지·알람은
   런타임이 제공하는 것이라, 모킹하면 정작 검증하고 싶은 것이 사라진다.
   방 격리·하이버네이션 복원·빈 방 회수는 여기서만 진짜로 확인된다.

   순수 로직(Room·validation·RankingService)은 tests/에서 Node로 돈다.
   ============================================================ */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@arcade/shared";

/** 방 코드로 접속해 메시지를 주고받는 테스트 클라이언트. */
async function connect(code: string) {
  const response = await SELF.fetch(`https://test/ws?code=${code}`, {
    headers: { Upgrade: "websocket" },
  });
  const ws = response.webSocket;
  if (!ws) throw new Error("WebSocket 업그레이드 실패");
  ws.accept();

  const inbox: ServerMessage[] = [];
  ws.addEventListener("message", (event) => {
    inbox.push(JSON.parse(String(event.data)) as ServerMessage);
  });

  return {
    ws,
    inbox,
    send(message: unknown): void {
      ws.send(JSON.stringify(message));
    },
    /** 조건에 맞는 메시지가 올 때까지 기다렸다 꺼낸다(먼저 온 것도 확인). */
    async wait<T extends ServerMessage["type"]>(
      type: T,
      predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
      timeoutMs = 5000,
    ): Promise<Extract<ServerMessage, { type: T }>> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const index = inbox.findIndex(
          (message) => message.type === type && predicate(message as Extract<ServerMessage, { type: T }>),
        );
        if (index >= 0) return inbox.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`${type} 메시지가 오지 않았다 (받은 것: ${inbox.map((m) => m.type).join(", ") || "없음"})`);
    },
  };
}

async function createRoom(gameId = "jungnim"): Promise<string> {
  const response = await SELF.fetch(`https://test/rooms?gameId=${gameId}`, { method: "POST" });
  const body = (await response.json()) as { code: string };
  return body.code;
}

/** 접속 + 참가까지 한 번에. 대부분의 테스트가 여기서 시작한다.
 *  참가 직후의 room_state를 함께 돌려준다 — 여기서 소비해 버리므로
 *  호출한 쪽이 다시 기다리면 영원히 오지 않는다. */
async function join(code: string, nickname: string) {
  const client = await connect(code);
  const welcome = await client.wait("welcome");
  client.send({ type: "join_room", code, nickname });
  const roster = await client.wait("room_state");
  return Object.assign(client, { id: welcome.id, roster });
}

describe("방 수명주기 (HTTP 생성 → WS 접속)", () => {
  it("방을 만들면 그 코드로 접속할 수 있다", async () => {
    const code = await createRoom();
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/); // 클라 입력 검증과 같은 형식

    const client = await connect(code);
    const welcome = await client.wait("welcome");
    expect(welcome.id).toBeTruthy();
  });

  it("없는 방에 접속하면 기존 서버와 같은 문구로 거절한다", async () => {
    // 문구가 바뀌면 클라의 에러 표시 경로가 어긋난다.
    const client = await connect("ZZZZ");
    const error = await client.wait("error");
    expect(error.reason).toBe("방을 찾을 수 없습니다.");
  });

  it("유효하지 않은 게임 id로는 방을 만들 수 없다", async () => {
    const response = await SELF.fetch("https://test/rooms?gameId=bad%20id!", { method: "POST" });
    expect(response.status).toBe(400);
  });

  it("헬스체크가 살아있다", async () => {
    const response = await SELF.fetch("https://test/health");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("방 만들기 응답에 CORS 헤더가 붙는다", async () => {
    // 프론트(Vercel)와 서버(Workers)는 출처가 다르다. 이 헤더가 빠지면 요청은
    // 도달해 방이 실제로 만들어지는데도 브라우저가 응답을 막는다 — 실제로 겪었다.
    const response = await SELF.fetch("https://test/rooms?gameId=jungnim", { method: "POST" });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("방 격리 (방 하나 = Durable Object 하나)", () => {
  it("같은 코드는 한 방에 모이고 다른 코드는 완전히 갈린다", async () => {
    // 이것이 "서버 머신 1대" 제약을 없앤 근거다.
    const roomA = await createRoom();
    const roomB = await createRoom();
    expect(roomA).not.toBe(roomB);

    await join(roomA, "고수");
    const second = await join(roomA, "초심자");
    // A 방에 둘이 모였다
    expect(second.roster.code).toBe(roomA);
    expect(second.roster.players.map((p) => p.nickname)).toEqual(["고수", "초심자"]);

    // B 방은 완전히 별개다 — 방금 들어온 한 명뿐이어야 한다
    const other = await join(roomB, "혼자");
    expect(other.roster.code).toBe(roomB);
    expect(other.roster.players.map((p) => p.nickname)).toEqual(["혼자"]);
  });
});

describe("전체 방 흐름", () => {
  it("생성, 입장, 스냅샷, 전원 사망, 대기실 복귀를 수행한다", async () => {
    const code = await createRoom();
    const host = await join(code, "Host");
    const guest = await join(code, "Guest");

    // 두 명이 모인 상태가 양쪽에 전파된다
    const roster = await host.wait("room_state", (m) => m.players.length === 2);
    expect(roster.hostId).toBe(host.id);

    host.send({ type: "start_game" });
    const startHost = await host.wait("game_start");
    const startGuest = await guest.wait("game_start");
    // 결정론의 출발점 — 갈리면 모두가 다른 세계를 겪는다
    expect(startHost.seed).toBe(startGuest.seed);
    expect(startHost.startTime).toBe(startGuest.startTime);

    // 카운트다운이 끝나야 playing으로 넘어간다
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, startHost.startTime - Date.now()) + 100));

    let snapshot = null;
    for (let attempt = 0; attempt < 40 && !snapshot; attempt++) {
      host.send({ type: "player_state", a: 10, b: 20 });
      guest.send({ type: "player_state", a: 30, b: 40 });
      await new Promise((resolve) => setTimeout(resolve, 110));
      snapshot = host.inbox.filter((m) => m.type === "peer_snapshot").pop() ?? null;
      if (snapshot && snapshot.peers.length < 2) snapshot = null;
    }
    expect(snapshot?.peers).toHaveLength(2);

    host.send({ type: "player_died", score: 1 });
    await guest.wait("peer_died", (m) => m.id === host.id);
    guest.send({ type: "player_died", score: 5 });

    const over = await host.wait("game_over");
    expect(over.finalRanks).toHaveLength(2);
    expect(over.finalRanks[0]!.nickname).toBe("Guest"); // 오래 버틴 쪽이 1등

    host.send({ type: "return_to_ready" });
    const ready = await host.wait("room_state", (m) => m.state === "waiting");
    expect(ready.players).toHaveLength(2);
  });

  it("발사(fire_effect)는 조준한 1명에게만 effect_hit으로 가고, 나머지·자신은 못 받는다", async () => {
    const code = await createRoom("curve");
    const host = await join(code, "Host");
    const a = await join(code, "A");
    const b = await join(code, "B");
    await host.wait("room_state", (m) => m.players.length === 3);

    host.send({ type: "start_game" });
    const start = await host.wait("game_start");
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, start.startTime - Date.now()) + 100));

    // 호스트가 A를 조준해 발사한다.
    host.send({ type: "fire_effect", kind: "invert", durationMs: 2500, targetId: a.id });

    // A만 맞는다 — 발사자(from)와 효과 내용이 그대로 전달된다.
    const hit = await a.wait("effect_hit");
    expect(hit).toMatchObject({ from: host.id, kind: "invert", durationMs: 2500 });

    // B(다른 관전자)와 호스트(자신)에겐 오지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(b.inbox.some((m) => m.type === "effect_hit")).toBe(false);
    expect(host.inbox.some((m) => m.type === "effect_hit")).toBe(false);
  });

  it("없는 id·자기 자신을 조준한 발사는 아무에게도 가지 않는다", async () => {
    const code = await createRoom("curve");
    const host = await join(code, "Host");
    const a = await join(code, "A");
    await host.wait("room_state", (m) => m.players.length === 2);
    host.send({ type: "start_game" });
    const start = await host.wait("game_start");
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, start.startTime - Date.now()) + 100));

    host.send({ type: "fire_effect", kind: "invert", durationMs: 2500, targetId: "ghost-id" }); // 없는 멤버
    host.send({ type: "fire_effect", kind: "invert", durationMs: 2500, targetId: host.id }); // 자기 자신
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(a.inbox.some((m) => m.type === "effect_hit")).toBe(false);
    expect(host.inbox.some((m) => m.type === "effect_hit")).toBe(false);
  });

  it("player_state의 ev는 다음 스냅샷에 딱 한 번 실려 남들에게 간다", async () => {
    const code = await createRoom();
    const host = await join(code, "Host");
    const guest = await join(code, "Guest");
    await host.wait("room_state", (m) => m.players.length === 2);
    host.send({ type: "start_game" });
    const start = await host.wait("game_start");
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, start.startTime - Date.now()) + 100));

    // 호스트가 이벤트를 얹어 보낸다. 서버는 의미를 모르고 그대로 중계한다.
    host.send({ type: "player_state", a: 10, b: 20, ev: "purge" });
    let carried: { id: string; ev?: string } | undefined;
    for (let attempt = 0; attempt < 40 && !carried; attempt++) {
      guest.send({ type: "player_state", a: 30, b: 40 }); // 스냅샷을 흐르게 하는 쪽
      await new Promise((resolve) => setTimeout(resolve, 110));
      carried = guest.inbox
        .filter((m) => m.type === "peer_snapshot")
        .flatMap((m) => m.peers)
        .find((peer) => peer.id === host.id && peer.ev !== undefined);
    }
    expect(carried?.ev).toBe("purge");

    // 한 번 실려 나간 뒤로는 다시 붙지 않는다(계속 켜져 있으면 남의 화면에서 반복 재생된다).
    guest.inbox.length = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      host.send({ type: "player_state", a: 11, b: 21 });
      guest.send({ type: "player_state", a: 31, b: 41 });
      await new Promise((resolve) => setTimeout(resolve, 110));
    }
    const repeated = guest.inbox
      .filter((m) => m.type === "peer_snapshot")
      .flatMap((m) => m.peers)
      .some((peer) => peer.ev !== undefined);
    expect(repeated).toBe(false);
  });

  it("호스트만 시작할 수 있다", async () => {
    const code = await createRoom();
    await join(code, "Host");
    const guest = await join(code, "Guest");

    guest.send({ type: "start_game" });
    const error = await guest.wait("error");
    expect(error.reason).toBe("호스트만 시작할 수 있습니다.");
  });

  it("호스트가 나가면 다음 사람이 승계한다", async () => {
    const code = await createRoom();
    const host = await join(code, "Host");
    const guest = await join(code, "Guest");
    await host.wait("room_state", (m) => m.players.length === 2);

    host.ws.close();
    const changed = await guest.wait("host_changed");
    expect(changed.newHostId).toBe(guest.id);
  });

  it("시작된 방에는 새로 참가할 수 없다", async () => {
    const code = await createRoom();
    const host = await join(code, "Host");
    host.send({ type: "start_game" });
    await host.wait("game_start");

    const late = await connect(code);
    await late.wait("welcome");
    late.send({ type: "join_room", code, nickname: "늦둥이" });
    const error = await late.wait("error");
    expect(error.reason).toBe("이미 시작된 방입니다.");
  });
});

describe("입력 검증", () => {
  it("깨진 JSON과 규칙 위반을 구분해 알린다", async () => {
    const code = await createRoom();
    const client = await join(code, "고수");

    client.ws.send("{{{");
    expect((await client.wait("error")).reason).toBe("잘못된 메시지 형식입니다.");

    client.send({ type: "join_room", code: "zzzz", nickname: "" });
    expect((await client.wait("error")).reason).toBe("유효하지 않은 메시지입니다.");
  });

  /** 방을 하나 만들어 라운드가 도는 상태까지 데려간다. */
  async function playing(gameId: string) {
    const code = await createRoom(gameId);
    const host = await join(code, "Host");
    host.send({ type: "start_game" });
    const start = await host.wait("game_start");
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, start.startTime - Date.now()) + 100));
    return host;
  }

  it("경과 시간보다 오래 버텼다는 주장은 거부한다", async () => {
    // 상한만 막는다 — "일찍 죽고 늦게 신고"는 못 막는다(서버가 게임을 모른다).
    // 리플레이 검증을 하지 않기로 한 이유는 DESIGN 10절 참조.
    const host = await playing("jungnim");
    host.send({ type: "player_died", score: 100_000 });
    expect((await host.wait("error")).reason).toBe("유효하지 않은 기록입니다.");
  });

  it("점수가 기록인 게임에는 그 상한을 걸지 않는다", async () => {
    // 같은 숫자, 다른 게임. 흐른 시간과 견주는 건 기록이 시간일 때만 뜻이 있고,
    // 점수형에 걸면 막지도 못하면서 게임의 점수 규모에 없던 벽만 세운다(timedGames.ts).
    const host = await playing("baseball");
    host.send({ type: "player_died", score: 100_000 });
    // 거부 대신 라운드가 정상 종료된다(혼자였으니 곧 game_over).
    const over = await host.wait("game_over");
    expect(over.finalRanks[0]!.score).toBe(100_000);
  });

  it("클럭 동기화 요청에 같은 requestId로 답한다", async () => {
    const code = await createRoom();
    const client = await join(code, "고수");

    client.send({ type: "time_sync_request", requestId: "abc-1" });
    const response = await client.wait("time_sync_response");
    expect(response.requestId).toBe("abc-1");
    expect(Number.isFinite(response.serverTime)).toBe(true);
  });
});

describe("빈 방 유예 (alarm 회수)", () => {
  // vitest.config.ts에서 ROOM_GRACE_MS=1000으로 줄여 두었다(운영 기본값 60초).
  const GRACE_MS = 1000;

  it("유예 안에는 방이 살아있고, 지나면 회수된다", async () => {
    const code = await createRoom();
    const host = await join(code, "Host");

    host.ws.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 유예 중 — 새로고침으로 돌아온 사람이 같은 코드로 재입장할 수 있어야 한다
    const early = await connect(code);
    expect((await early.wait("welcome")).id).toBeTruthy();
    early.ws.close();

    await new Promise((resolve) => setTimeout(resolve, GRACE_MS + 1500));

    // 유예 후 — 죽은 방이 코드를 영원히 붙들면 안 된다
    const late = await connect(code);
    expect((await late.wait("error")).reason).toBe("방을 찾을 수 없습니다.");
  });

  it("사람이 남아 있으면 유예가 지나도 회수하지 않는다", async () => {
    const code = await createRoom();
    await join(code, "머무는사람");

    await new Promise((resolve) => setTimeout(resolve, GRACE_MS + 1500));

    const client = await connect(code);
    expect((await client.wait("welcome")).id).toBeTruthy();
  });
});
