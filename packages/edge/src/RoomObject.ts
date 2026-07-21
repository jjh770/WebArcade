/* ============================================================
   RoomObject — 방 하나 = Durable Object 하나
   ------------------------------------------------------------
   기존 서버의 `RoomManager`가 방을 Map에 들고 있던 자리를 대신한다.
   방 코드로 `idFromName(code)` 하면 전 세계에서 **같은 오브젝트 하나**로
   라우팅되므로, "서버 머신은 반드시 1대"라는 제약이 사라진다. (DESIGN 10절)

   ⚠️ Hibernation API를 쓴다 (`ctx.acceptWebSocket`).
      `server.accept()`를 쓰면 연결이 살아있는 내내 duration 과금이 붙는다.
      대신 하이버네이션되면 **이 클래스의 메모리 필드가 날아간다** —
      그래서 방 상태는 반드시 `ctx.storage`에 있어야 하고, 메모리 필드는
      스토리지의 캐시로만 취급한다. 소켓별 신원도 마찬가지라
      `serializeAttachment`로 소켓에 붙여 둔다(Map에 들고 있으면 날아간다).

   ⚠️ "없는 방"이라는 개념: `idFromName(code)`는 코드가 뭐든 **항상** 스텁을
      돌려준다. 기존 `RoomManager.getRoom()`처럼 undefined가 나오지 않는다.
      그래서 스토리지에 방 레코드가 있는지로 존재 여부를 판단한다.

   현재 단계: 방 존재·코드 발급 + 참가/이탈과 room_state 중계까지.
   시드·카운트다운·위치 중계·순위는 다음 단계.
   ============================================================ */

import type { ServerMessage } from "@arcade/shared";
import { Room, ROOM_CAPACITY, type RoomSnapshot } from "./Room";
import { parseClientMessage } from "./validation";

const ROOM_KEY = "room";

/** 소켓에 붙여 두는 신원. 하이버네이션을 건너 살아남는다. */
type SocketMeta = { id: string };

export class RoomObject {
  /** 스토리지의 캐시. 하이버네이션에서 깨면 비어 있으므로 생성자에서 되살린다. */
  private room: Room | null = null;

  constructor(private readonly ctx: DurableObjectState) {
    // blockConcurrencyWhile: 이 안의 작업이 끝나기 전에는 어떤 요청도 처리되지 않는다.
    // 하이버네이션에서 깨어난 직후 빈 상태로 요청을 받는 사고를 막는 유일한 장치다.
    ctx.blockConcurrencyWhile(async () => {
      const snapshot = await ctx.storage.get<RoomSnapshot>(ROOM_KEY);
      this.room = snapshot ? Room.restore(snapshot, ROOM_CAPACITY) : null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/claim") return this.claim(url);
    if (url.pathname === "/ws") return this.connect(request);
    return new Response("Not Found", { status: 404 });
  }

  /** 이 코드를 이 방이 선점한다. 이미 쓰이고 있으면 409 —
   *  Worker가 그걸 보고 다른 코드로 재시도한다(기존의 코드 충돌 검사 대체). */
  private async claim(url: URL): Promise<Response> {
    if (this.room) return new Response("taken", { status: 409 });

    const room = new Room(
      url.searchParams.get("code") ?? "",
      url.searchParams.get("gameId") ?? "",
      ROOM_CAPACITY,
    );
    // 방이 만들어지자마자 유예 시계를 켠다 — 만들어놓고 아무도 안 들어오면
    // 영원히 남는다. 첫 참가자가 들어오면 addMember가 꺼 준다.
    room.markEmpty(Date.now());

    // 메모리보다 스토리지가 먼저다 — 쓰기가 실패하면 방이 있다고 착각하면 안 된다.
    await this.ctx.storage.put(ROOM_KEY, room.snapshot());
    this.room = room;
    return Response.json({ code: room.code, gameId: room.gameId });
  }

  private connect(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // WebSocketPair: [클라에게 돌려줄 쪽, 서버가 들고 있을 쪽]
    const { 0: client, 1: server } = new WebSocketPair();

    if (!this.room) {
      // 없는 방이다. HTTP 404로 끊지 않고 **기존 서버와 같은 문구**를 WS로 보낸 뒤 닫는다
      // — 클라의 에러 표시 경로를 그대로 쓰기 위해.
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "error", reason: "방을 찾을 수 없습니다." } satisfies ServerMessage));
      server.close(1000, "room not found");
      return new Response(null, { status: 101, webSocket: client });
    }

    // 신원을 소켓에 붙인다. 메모리 Map에 들고 있으면 하이버네이션 때 날아가
    // 깨어난 뒤 "이 소켓이 누구였는지" 알 수 없게 된다.
    const id = crypto.randomUUID();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id } satisfies SocketMeta);
    server.send(JSON.stringify({ type: "welcome", id } satisfies ServerMessage));

    return new Response(null, { status: 101, webSocket: client });
  }

  /** 하이버네이션에서 깨어나 메시지를 받는 진입점.
   *  기존 `socket.on("message", ...)`에 대응한다. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const id = this.idOf(ws);
    if (id === null || !this.room) return;

    let raw: unknown;
    try {
      raw = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      return this.send(ws, { type: "error", reason: "잘못된 메시지 형식입니다." });
    }

    const msg = parseClientMessage(raw);
    if (!msg) return this.send(ws, { type: "error", reason: "유효하지 않은 메시지입니다." });

    switch (msg.type) {
      case "time_sync_request":
        // 클럭 동기화는 방 상태와 무관하다 — 저장할 것도 알릴 것도 없다.
        this.send(ws, { type: "time_sync_response", requestId: msg.requestId, serverTime: Date.now() });
        return;

      case "join_room": {
        if (this.room.hasConnectedMember(id)) {
          return this.send(ws, { type: "error", reason: "이미 다른 방에 참가 중입니다." });
        }
        if (this.room.state !== "waiting") {
          return this.send(ws, { type: "error", reason: "이미 시작된 방입니다." });
        }
        if (!this.room.addMember(id, msg.nickname)) {
          return this.send(ws, { type: "error", reason: `방 정원은 최대 ${ROOM_CAPACITY}명입니다.` });
        }
        await this.persist();
        this.broadcastRoomState();
        return;
      }

      case "leave_room":
        await this.handleLeave(id);
        return;

      default:
        // start_game / player_state / player_died는 다음 단계에서 붙는다.
        return;
    }
  }

  /** 기존 `socket.on("close", ...)`에 대응.
   *
   *  ⚠️ 여기서 `ws.close()`를 부르면 안 된다. 이 콜백은 소켓이 **이미 닫힌 뒤**에
   *     불리므로 또 닫으려 하면 예외가 난다(로컬 검증에서 실제로 3번 터졌다). */
  async webSocketClose(ws: WebSocket): Promise<void> {
    const id = this.idOf(ws);
    if (id !== null) await this.handleLeave(id);
  }

  /** 나감 처리. 마지막 한 명이 나가도 방을 지우지 않고 유예를 켠다 —
   *  새로고침·네트워크 끊김으로 나간 사람이 같은 코드로 돌아올 수 있게. */
  private async handleLeave(id: string): Promise<void> {
    if (!this.room) return;
    const result = this.room.disconnectMember(id, Date.now());

    if (this.room.isEmpty()) {
      this.room.markEmpty(Date.now());
      await this.persist();
      // 유예가 끝난 빈 방의 회수(기존 reapExpired)는 alarm()으로 다음 단계에.
      return;
    }

    await this.persist();
    if (result.hostChanged) this.broadcast({ type: "host_changed", newHostId: result.hostChanged });
    // result.died에 따른 peer_died 통지와 게임 종료 판정은 다음 단계에.
    this.broadcastRoomState();
  }

  private async persist(): Promise<void> {
    if (this.room) await this.ctx.storage.put(ROOM_KEY, this.room.snapshot());
  }

  private idOf(ws: WebSocket): string | null {
    const meta = ws.deserializeAttachment() as SocketMeta | null;
    return meta?.id ?? null;
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    // 이미 닫힌 소켓에 쓰면 예외가 난다. 한 명의 끊김이 방 전체 처리를 멈추면 안 된다.
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 끊긴 소켓은 무시 — webSocketClose가 정리한다. */
    }
  }

  private broadcast(msg: ServerMessage): void {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) {
      const id = this.idOf(ws);
      // 아직 참가하지 않았거나 이미 나간 소켓은 건너뛴다. 나가는 소켓은 이 시점에도
      // getWebSockets()에 남아 있을 수 있어, 멤버 목록을 기준으로 걸러야 한다.
      if (id !== null && this.room.hasConnectedMember(id)) this.send(ws, msg);
    }
  }

  private broadcastRoomState(): void {
    if (!this.room) return;
    const hostId = this.room.hostId;
    if (!hostId) return;
    this.broadcast({
      type: "room_state",
      code: this.room.code,
      gameId: this.room.gameId,
      state: this.room.state,
      players: this.room.getPublicPlayers(),
      hostId,
    });
  }
}
