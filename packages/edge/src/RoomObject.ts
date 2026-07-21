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
import { roomGraceMs, type Env } from "./env";
import { RankingService } from "./RankingService";
import { Room, ROOM_CAPACITY, type RoomSnapshot } from "./Room";
import { parseClientMessage } from "./validation";

const ROOM_KEY = "room";

/** 시작 버튼을 누르고 실제로 tick 0이 되기까지의 여유. 기존 서버와 같은 값.
 *  이 시간 안에 모든 클라가 game_start를 받고 카운트다운 연출을 마쳐야 한다. */
const COUNTDOWN_MS = 3000;

/** 관전용 위치를 방 전체에 묶어 내보내는 최소 간격. 기존 서버와 같은 10Hz. */
const SNAPSHOT_MS = 100;

/** 자기신고 생존시간의 허용 오차(tick). 이보다 더 오래 버텼다는 주장은 거부한다.
 *  ⚠️ 상한만 막을 뿐 "일찍 죽고 늦게 신고"는 못 막는다 — 서버가 게임을 모르기 때문.
 *     리플레이 검증을 하지 않기로 한 이유는 DESIGN 10절 참조. */
const SURVIVAL_TOLERANCE_TICKS = 120;

/** 소켓에 붙여 두는 신원. 하이버네이션을 건너 살아남는다. */
type SocketMeta = { id: string };

export class RoomObject {
  /** 스토리지의 캐시. 하이버네이션에서 깨면 비어 있으므로 생성자에서 되살린다. */
  private room: Room | null = null;

  /** 마지막으로 peer_snapshot을 내보낸 시각. 기존 서버의 setInterval을 대신하는 스로틀.
   *  ⚠️ 일부러 스토리지에 넣지 않는다 — 날아가도 스냅샷 한 번 더 나가는 게 전부다. */
  private lastSnapshotAt = 0;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
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
    // 만들어놓고 아무도 안 들어오는 방도 유예 뒤에 회수되어야 한다.
    await this.armReaper();
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
        // 사람이 있는 방은 회수 대상이 아니다 — 걸어둔 알람을 끈다.
        await this.ctx.storage.deleteAlarm();
        await this.persist();
        this.broadcastRoomState();
        return;
      }

      case "start_game": {
        if (this.room.hostId !== id) {
          return this.send(ws, { type: "error", reason: "호스트만 시작할 수 있습니다." });
        }
        if (this.room.state !== "waiting") {
          return this.send(ws, { type: "error", reason: "대기 상태에서만 시작할 수 있습니다." });
        }

        // 시드는 **서버가 한 번만** 뽑아 방 전체에 같은 값을 뿌린다. 이게 모두가 같은
        // 세계를 겪는 근거다. node의 randomBytes를 Web Crypto로 바꿨을 뿐 의미는 같다
        // (게임 로직의 난수가 아니라 게임의 씨앗이므로 결정론과 무관한 자리).
        const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
        const startTime = Date.now() + COUNTDOWN_MS;

        this.room.startCountdown(seed, startTime);
        await this.persist();
        this.broadcastRoomState();
        this.broadcast({ type: "game_start", seed, startTime, gameId: this.room.gameId });
        return;
      }

      case "return_to_ready": {
        if (this.room.hostId !== id) {
          return this.send(ws, { type: "error", reason: "호스트만 다시 대기실로 이동할 수 있습니다." });
        }
        if (this.room.state !== "finished") {
          return this.send(ws, { type: "error", reason: "종료된 게임에서만 다시 할 수 있습니다." });
        }
        this.room.returnToWaiting();
        await this.persist();
        this.broadcastRoomState();
        return;
      }

      case "player_state": {
        const now = Date.now();
        if (!this.room.ensurePlaying(now)) return;
        this.room.updatePosition(id, msg.px, msg.py);

        // ⚠️ 여기서 persist() 하지 않는다. 위치는 10Hz × 인원수로 들어오므로
        //    매번 저장하면 무료 티어의 하루 쓰기 한도(10만)를 한 시간에 태운다.
        //    위치는 관전용 근사치라 날아가도 다음 갱신이 곧 채운다.
        //    (state 전이도 startTime에서 다시 계산되므로 저장할 필요가 없다.)

        // 기존 서버는 setInterval로 100ms마다 뿌렸다. DO에서 살아있는 타이머는
        // 오브젝트를 메모리에 붙들어 하이버네이션을 막으므로(=유휴에도 과금),
        // 들어오는 위치에 얹어 같은 주기로 내보낸다. 아무도 안 보내면 안 나가고
        // 오브젝트는 잠들 수 있다.
        if (now - this.lastSnapshotAt >= SNAPSHOT_MS) {
          this.lastSnapshotAt = now;
          this.broadcast({ type: "peer_snapshot", peers: this.room.getPeerSnapshot() });
        }
        return;
      }

      case "player_died": {
        const now = Date.now();
        if (!this.room.ensurePlaying(now)) return;
        if (msg.survivalTicks > this.room.elapsedTicks(now) + SURVIVAL_TOLERANCE_TICKS) {
          return this.send(ws, { type: "error", reason: "유효하지 않은 생존시간입니다." });
        }
        if (!this.room.markDied(id, msg.survivalTicks)) return;
        await this.persist(); // 사망은 라운드당 한 번뿐이라 저장해도 싸다.
        this.broadcastExcept(id, { type: "peer_died", id });
        await this.checkGameOver();
        return;
      }

      case "leave_room":
        await this.handleLeave(id);
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
    // 나가면서 disconnectMember가 상태를 바꿀 수 있으므로 먼저 읽어 둔다.
    const wasRoundActive = this.room.state === "countdown" || this.room.state === "playing";
    const result = this.room.disconnectMember(id, Date.now());

    if (this.room.isEmpty()) {
      this.room.markEmpty(Date.now());
      await this.persist();
      await this.armReaper();
      return;
    }

    await this.persist();
    if (result.hostChanged) this.broadcast({ type: "host_changed", newHostId: result.hostChanged });
    // 라운드 중 이탈은 사망으로 처리된다 — 남은 사람의 관전 대상 교체 신호가 필요하다.
    if (result.died) this.broadcastExcept(id, { type: "peer_died", id });
    this.broadcastRoomState();
    if (wasRoundActive) await this.checkGameOver();
  }

  /** 순위를 갱신해 알리고, 전원 사망이면 라운드를 끝낸다.
   *  서버는 게임을 모른다 — 생존시간만 모아 순서를 매길 뿐이다. */
  private async checkGameOver(): Promise<void> {
    if (!this.room || this.room.state === "finished") return;
    const members = this.room.getRankingMembers();
    const alive = RankingService.aliveCount(members);
    this.broadcast({ type: "ranking_update", alive, ranks: RankingService.computeRanks(members) });
    if (alive > 0) return;

    this.room.finish();
    await this.persist();
    this.broadcast({ type: "game_over", finalRanks: RankingService.computeRanks(members) });
  }

  /** 유예가 끝나면 스스로를 회수하도록 알람을 건다.
   *
   *  기존 서버는 `setInterval`로 10초마다 **모든 방**을 훑어 만료된 것을 지웠다
   *  (`RoomManager.reapExpired`). DO에는 훑을 중앙 목록이 없어서 방마다 자기
   *  알람을 건다. 이쪽이 오히려 정확하다 — 훑는 주기가 유예보다 길면 "유예는
   *  끝났는데 방은 아직 살아있는" 구간이 생겼는데, 알람은 제 시각에 울린다. */
  private async armReaper(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + roomGraceMs(this.env));
  }

  /** 유예 만료 시각에 런타임이 부른다(하이버네이션 중이면 깨워서 부른다). */
  async alarm(): Promise<void> {
    if (!this.room || !this.room.isEmpty()) return; // 그새 누가 들어왔다 → 회수 안 함

    const grace = roomGraceMs(this.env);
    if (!this.room.isExpired(Date.now(), grace)) {
      // 들어왔다 다시 나가며 유예 시계가 갱신됐다 → 남은 시간만큼 다시 건다.
      await this.ctx.storage.setAlarm((this.room.emptySince ?? Date.now()) + grace);
      return;
    }

    // 참가하지 않고 붙어만 있던 소켓이 남아 있을 수 있다. 방이 사라지면
    // 이 소켓들은 갈 곳이 없으므로 닫아 준다.
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, "room expired");
      } catch {
        /* 이미 닫힌 소켓은 무시 */
      }
    }

    // 스토리지를 비우면 이 오브젝트는 다시 "없는 방"이 된다 —
    // 같은 코드를 나중에 다른 방이 재사용할 수 있다(기존 deleteRoom과 같은 효과).
    await this.ctx.storage.deleteAll();
    this.room = null;
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

  /** 한 명만 빼고 알린다. 자기 사망은 자기가 이미 아는 사실이라 되돌려 보내지 않는다. */
  private broadcastExcept(exceptId: string, msg: ServerMessage): void {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) {
      const id = this.idOf(ws);
      if (id !== null && id !== exceptId && this.room.hasConnectedMember(id)) this.send(ws, msg);
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
