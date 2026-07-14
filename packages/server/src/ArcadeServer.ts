import { randomBytes, randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@arcade/shared";
import { RankingService } from "./RankingService.js";
import type { Room } from "./Room.js";
import { RoomManager } from "./RoomManager.js";
import { parseClientMessage } from "./validation.js";

const COUNTDOWN_MS = 3000;
const SNAPSHOT_MS = 100;
const SURVIVAL_TOLERANCE_TICKS = 120;

export type ArcadeServer = {
  wss: WebSocketServer;
  close(): Promise<void>;
};

export type ArcadeServerOptions = { port: number; countdownMs?: number; snapshotMs?: number };

export function createArcadeServer(input: number | ArcadeServerOptions): ArcadeServer {
  const options = typeof input === "number" ? { port: input } : input;
  const countdownMs = options.countdownMs ?? COUNTDOWN_MS;
  const snapshotMs = options.snapshotMs ?? SNAPSHOT_MS;
  const wss = new WebSocketServer({ port: options.port });
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
      rooms.deleteRoom(room.code);
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

  return {
    wss,
    close: () => new Promise((resolve) => {
      clearInterval(snapshotTimer);
      for (const socket of wss.clients) socket.terminate();
      wss.close(() => resolve());
    }),
  };
}
