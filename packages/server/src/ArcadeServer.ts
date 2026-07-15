import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@arcade/shared";
import { RankingService } from "./RankingService.js";
import type { Room } from "./Room.js";
import { RoomManager } from "./RoomManager.js";
import { parseClientMessage } from "./validation.js";

const COUNTDOWN_MS = 3000;
const SNAPSHOT_MS = 100;
const SURVIVAL_TOLERANCE_TICKS = 120;

/** 빈 방을 남겨두는 시간. 이 안에 돌아오면 같은 코드로 방이 이어진다.
 *  짧으면 새로고침 한 번에 방이 날아가고, 길면 죽은 방이 코드를 붙들고 있는다. */
const ROOM_GRACE_MS = 60_000;
/** 만료된 빈 방을 회수하는 주기(상한). 유예보다 촘촘해야 만료가 제때 반영된다 —
 *  주기가 유예보다 길면 "유예는 끝났는데 방은 아직 살아있는" 구간이 생긴다. */
const REAP_INTERVAL_MS = 10_000;
const MIN_REAP_INTERVAL_MS = 500;

/** 회수 주기는 유예의 절반을 넘지 않게 잡는다(짧은 유예를 쓰는 테스트에서도 정확). */
function reapIntervalFor(graceMs: number): number {
  return Math.max(MIN_REAP_INTERVAL_MS, Math.min(REAP_INTERVAL_MS, graceMs / 2));
}

export type ArcadeServer = {
  wss: WebSocketServer;
  /** WS를 얹은 HTTP 서버. 헬스체크(GET /health)를 받는다. */
  http: Server;
  close(): Promise<void>;
};

export type ArcadeServerOptions = {
  port: number;
  countdownMs?: number;
  snapshotMs?: number;
  /** 빈 방 유예(ms). 테스트에서 짧게 줄여 만료를 검증한다. */
  roomGraceMs?: number;
};

export function createArcadeServer(input: number | ArcadeServerOptions): ArcadeServer {
  const options = typeof input === "number" ? { port: input } : input;
  const countdownMs = options.countdownMs ?? COUNTDOWN_MS;
  const snapshotMs = options.snapshotMs ?? SNAPSHOT_MS;
  const graceMs = options.roomGraceMs ?? ROOM_GRACE_MS;

  // ws가 자체 HTTP 서버를 만들게 두면 평문 GET에 400/426으로 답해 헬스체크가 실패한다.
  // HTTP 서버를 직접 두고 그 위에 WS를 얹어, 배포 플랫폼이 "살아있음"을 확인할 수 있게 한다.
  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: http });
  http.listen(options.port);
  const rooms = new RoomManager();
  const idBySocket = new Map<WebSocket, string>();
  const socketById = new Map<string, WebSocket>();
  const roomCodeById = new Map<string, string>();

  const send = (id: string, msg: ServerMessage): void => {
    const ws = socketById.get(id);
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const broadcast = (room: Room, msg: ServerMessage): void => {
    for (const member of room.getConnectedMembers()) send(member.id, msg);
  };

  const broadcastExcept = (room: Room, exceptId: string, msg: ServerMessage): void => {
    for (const member of room.getConnectedMembers()) if (member.id !== exceptId) send(member.id, msg);
  };

  const broadcastRoomState = (room: Room): void => {
    const hostId = room.hostId;
    if (!hostId) return;
    broadcast(room, {
      type: "room_state",
      code: room.code,
      gameId: room.gameId,
      state: room.state,
      players: room.getPublicPlayers(),
      hostId,
    });
  };

  const roomOf = (id: string): Room | undefined => {
    const code = roomCodeById.get(id);
    return code ? rooms.getRoom(code) : undefined;
  };

  const checkGameOver = (room: Room): void => {
    if (room.state === "finished") return;
    const members = room.getRankingMembers();
    const alive = RankingService.aliveCount(members);
    broadcast(room, { type: "ranking_update", alive, ranks: RankingService.computeRanks(members) });
    if (alive === 0) {
      room.finish();
      broadcast(room, { type: "game_over", finalRanks: RankingService.computeRanks(members) });
    }
  };

  const handleLeave = (id: string): void => {
    const room = roomOf(id);
    roomCodeById.delete(id);
    if (!room) return;
    const wasRoundActive = room.state === "countdown" || room.state === "playing";
    const result = room.disconnectMember(id, Date.now());
    if (room.isEmpty()) {
      // 지우지 않고 유예를 켠다. 새로고침·네트워크 끊김으로 나간 사람이 같은 코드로
      // 돌아오면 방이 그대로 이어진다(돌아온 사람이 다시 호스트가 된다).
      room.markEmpty(Date.now());
      return;
    }
    if (result.hostChanged) broadcast(room, { type: "host_changed", newHostId: result.hostChanged });
    if (result.died) broadcastExcept(room, id, { type: "peer_died", id });
    broadcastRoomState(room);
    if (wasRoundActive) checkGameOver(room);
  };

  const handleMessage = (id: string, msg: ClientMessage): void => {
    if (msg.type === "time_sync_request") {
      send(id, { type: "time_sync_response", requestId: msg.requestId, serverTime: Date.now() });
      return;
    }

    switch (msg.type) {
      case "create_room": {
        if (roomCodeById.has(id)) return send(id, { type: "error", reason: "이미 다른 방에 참가 중입니다." });
        const room = rooms.createRoom(msg.gameId);
        room.addMember(id, msg.nickname);
        roomCodeById.set(id, room.code);
        broadcastRoomState(room);
        break;
      }
      case "join_room": {
        if (roomCodeById.has(id)) return send(id, { type: "error", reason: "이미 다른 방에 참가 중입니다." });
        const room = rooms.getRoom(msg.code);
        if (!room) return send(id, { type: "error", reason: "방을 찾을 수 없습니다." });
        if (room.state !== "waiting") return send(id, { type: "error", reason: "이미 시작된 방입니다." });
        if (!room.addMember(id, msg.nickname)) return send(id, { type: "error", reason: "방 정원은 최대 32명입니다." });
        roomCodeById.set(id, room.code);
        broadcastRoomState(room);
        break;
      }
      case "start_game": {
        const room = roomOf(id);
        if (!room) return;
        if (room.hostId !== id) return send(id, { type: "error", reason: "호스트만 시작할 수 있습니다." });
        if (room.state !== "waiting") return send(id, { type: "error", reason: "대기 상태에서만 시작할 수 있습니다." });
        const seed = randomBytes(4).readUInt32LE(0);
        const startTime = Date.now() + countdownMs;
        room.startCountdown(seed, startTime);
        broadcastRoomState(room);
        broadcast(room, { type: "game_start", seed, startTime, gameId: room.gameId });
        break;
      }
      case "return_to_ready": {
        const room = roomOf(id);
        if (!room) return;
        if (room.hostId !== id) return send(id, { type: "error", reason: "호스트만 다시 대기실로 이동할 수 있습니다." });
        if (room.state !== "finished") return send(id, { type: "error", reason: "종료된 게임에서만 다시 할 수 있습니다." });
        room.returnToWaiting();
        broadcastRoomState(room);
        break;
      }
      case "player_state": {
        const room = roomOf(id);
        if (!room || !room.ensurePlaying(Date.now())) return;
        room.updatePosition(id, msg.px, msg.py);
        break;
      }
      case "player_died": {
        const room = roomOf(id);
        const now = Date.now();
        if (!room || !room.ensurePlaying(now)) return;
        if (msg.survivalTicks > room.elapsedTicks(now) + SURVIVAL_TOLERANCE_TICKS) {
          return send(id, { type: "error", reason: "유효하지 않은 생존시간입니다." });
        }
        if (!room.markDied(id, msg.survivalTicks)) return;
        broadcastExcept(room, id, { type: "peer_died", id });
        checkGameOver(room);
        break;
      }
      case "leave_room":
        handleLeave(id);
        break;
    }
  };

  wss.on("connection", (socket) => {
    const id = randomUUID();
    idBySocket.set(socket, id);
    socketById.set(id, socket);
    send(id, { type: "welcome", id });

    socket.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString()) as unknown;
      } catch {
        return send(id, { type: "error", reason: "잘못된 메시지 형식입니다." });
      }
      const msg = parseClientMessage(parsed);
      if (!msg) return send(id, { type: "error", reason: "유효하지 않은 메시지입니다." });
      handleMessage(id, msg);
    });

    socket.on("close", () => {
      handleLeave(id);
      idBySocket.delete(socket);
      socketById.delete(id);
    });
  });

  const snapshotTimer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.getRooms()) {
      if (!room.ensurePlaying(now)) continue;
      broadcast(room, { type: "peer_snapshot", peers: room.getPeerSnapshot() });
    }
  }, snapshotMs);

  // 유예가 끝난 빈 방을 회수한다. 이게 없으면 버려진 방이 코드를 영원히 붙들고 메모리에 쌓인다.
  const reapTimer = setInterval(() => {
    rooms.reapExpired(Date.now(), graceMs);
  }, reapIntervalFor(graceMs));

  return {
    wss,
    http,
    close: () => new Promise((resolve) => {
      clearInterval(snapshotTimer);
      clearInterval(reapTimer);
      for (const socket of wss.clients) socket.terminate();
      // WS를 먼저 닫고, 그 위를 받치던 HTTP 서버를 닫는다(순서 뒤집으면 소켓이 남는다).
      wss.close(() => http.close(() => resolve()));
    }),
  };
}
