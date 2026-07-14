/* ============================================================
   서버 진입점 — WebSocket(ws) 라우팅
   ------------------------------------------------------------
   서버는 게임을 모른다. 하는 일: 방·접속자 관리, 시드 배포, 사망 집계·순위.
   화살은 네트워크를 한 번도 타지 않는다 — 각 클라가 시드로 로컬 생성.

   결정론 주의: 여기서 Date.now()/Math.random()을 쓰는 건 게임 로직이 아니라
   "시드 선택"과 "카운트다운 시작 시각"을 위한 것. 게임 진행은 클라의 고정
   스텝 + 시드에서만 나온다.
   ============================================================ */

import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { ClientMessage, ServerMessage } from "@arcade/shared";
import { RoomManager } from "./RoomManager";
import { RankingService } from "./RankingService";
import type { Room } from "./Room";

const PORT = Number(process.env.PORT ?? 8080);
/** 시드 배포 후 이 시간 뒤에 모두 tick=0으로 동시 시작(각 클라가 자기 시계로 카운트다운). */
const COUNTDOWN_MS = 3000;

const wss = new WebSocketServer({ port: PORT });
const rooms = new RoomManager();

/** 커넥션마다 부여하는 정보. */
const idBySocket = new Map<WebSocket, string>();
const socketById = new Map<string, WebSocket>();
const roomCodeById = new Map<string, string>();

function send(id: string, msg: ServerMessage): void {
  const ws = socketById.get(id);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerMessage): void {
  for (const m of room.getMembers()) send(m.id, msg);
}

function broadcastExcept(room: Room, exceptId: string, msg: ServerMessage): void {
  for (const m of room.getMembers()) if (m.id !== exceptId) send(m.id, msg);
}

function broadcastRoomState(room: Room): void {
  const hostId = room.hostId;
  if (hostId === null) return;
  broadcast(room, {
    type: "room_state",
    code: room.code,
    players: room.getMembers().map((m) => ({
      id: m.id,
      nickname: m.nickname,
      alive: m.alive,
      survivalTicks: m.survivalTicks,
    })),
    hostId,
  });
}

/** 사망 집계 후, 전원 사망이면 game_over 브로드캐스트.
 *  ⚠️ 각자 자기 런을 끝까지 뛴다 — 남이 죽어도 내 판은 안 끝난다.
 *  전원(alive===0) 죽어야 종료하고 생존시간 순으로 순위. (원래 DESIGN 4.8의
 *  "최후 1인" 즉시 종료에서 사용자 판단으로 변경) */
function checkGameOver(room: Room): void {
  const alive = RankingService.aliveCount(room.getMembers());
  broadcast(room, {
    type: "ranking_update",
    alive,
    ranks: RankingService.computeRanks(room.getMembers()),
  });
  if (alive === 0) {
    room.finish();
    broadcast(room, { type: "game_over", finalRanks: RankingService.computeRanks(room.getMembers()) });
  }
}

function roomOf(id: string): Room | undefined {
  const code = roomCodeById.get(id);
  return code ? rooms.getRoom(code) : undefined;
}

function handleLeave(id: string): void {
  const room = roomOf(id);
  roomCodeById.delete(id);
  if (!room) return;
  const wasPlaying = room.state === "playing";
  const { hostChanged } = room.removeMember(id);

  if (room.isEmpty()) {
    rooms.deleteRoom(room.code);
    return;
  }
  if (hostChanged) broadcast(room, { type: "host_changed", newHostId: hostChanged });
  broadcastRoomState(room);
  // 진행 중 누가 나가서 최후 1인이 되면 판 종료.
  if (wasPlaying) checkGameOver(room);
}

function handleMessage(id: string, msg: ClientMessage): void {
  switch (msg.type) {
    case "create_room": {
      const room = rooms.createRoom(msg.gameId);
      room.addMember({ id, nickname: msg.nickname, alive: true, survivalTicks: 0 });
      roomCodeById.set(id, room.code);
      broadcastRoomState(room);
      break;
    }
    case "join_room": {
      const room = rooms.getRoom(msg.code);
      if (!room) return send(id, { type: "error", reason: "방을 찾을 수 없습니다." });
      if (room.state !== "waiting") return send(id, { type: "error", reason: "이미 시작된 방입니다." });
      room.addMember({ id, nickname: msg.nickname, alive: true, survivalTicks: 0 });
      roomCodeById.set(id, room.code);
      broadcastRoomState(room);
      break;
    }
    case "start_game": {
      const room = roomOf(id);
      if (!room) return;
      if (room.hostId !== id) return send(id, { type: "error", reason: "호스트만 시작할 수 있습니다." });
      if (room.state === "playing") return; // 이미 진행 중.
      const seed = Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
      room.startGame(seed);
      const startTime = Date.now() + COUNTDOWN_MS;
      broadcast(room, { type: "game_start", seed, startTime, gameId: room.gameId });
      break;
    }
    case "player_state": {
      // 관전용 위치 중계. 서버는 좌표를 해석하지 않고 방의 다른 사람에게만 넘긴다.
      const room = roomOf(id);
      if (!room || room.state !== "playing") return;
      broadcastExcept(room, id, { type: "peer_state", id, px: msg.px, py: msg.py });
      break;
    }
    case "player_died": {
      const room = roomOf(id);
      if (!room || room.state !== "playing") return;
      if (!room.markDied(id, msg.survivalTicks)) return;
      broadcastExcept(room, id, { type: "peer_died", id }); // 관전자들이 대상 교체하도록.
      checkGameOver(room);
      break;
    }
    case "leave_room": {
      handleLeave(id);
      break;
    }
  }
}

wss.on("connection", (socket) => {
  const id = randomUUID();
  idBySocket.set(socket, id);
  socketById.set(id, socket);
  send(id, { type: "welcome", id }); // 클라가 자기 id를 알아야 호스트 판별이 된다.

  socket.on("message", (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return send(id, { type: "error", reason: "잘못된 메시지 형식입니다." });
    }
    handleMessage(id, msg);
  });

  socket.on("close", () => {
    handleLeave(id);
    idBySocket.delete(socket);
    socketById.delete(id);
  });
});

console.log(`WebSocket 서버 실행 중: ws://localhost:${PORT}`);
