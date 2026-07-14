import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@arcade/shared";
import { createArcadeServer, type ArcadeServer } from "../packages/server/src/ArcadeServer";

type TestClient = {
  ws: WebSocket;
  wait(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage>;
};

const openServers: ArcadeServer[] = [];
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.terminate();
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

async function connect(url: string): Promise<TestClient> {
  const ws = new WebSocket(url);
  openSockets.push(ws);
  await once(ws, "open");
  const queue: ServerMessage[] = [];
  const waiters: { predicate: (message: ServerMessage) => boolean; resolve: (message: ServerMessage) => void }[] = [];
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else queue.push(message);
  });
  return {
    ws,
    wait: (predicate) => {
      const index = queue.findIndex(predicate);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("서버 메시지 대기 시간 초과")), 2000);
        waiters.push({ predicate, resolve: (message) => { clearTimeout(timeout); resolve(message); } });
      });
    },
  };
}

describe("WebSocket 전체 방 흐름", () => {
  it("생성, 입장, 스냅샷, 전원 사망, 대기실 복귀를 수행한다", async () => {
    const server = createArcadeServer({ port: 0, countdownMs: 10, snapshotMs: 10 });
    openServers.push(server);
    await once(server.wss, "listening");
    const port = (server.wss.address() as AddressInfo).port;
    const host = await connect(`ws://127.0.0.1:${port}`);
    const guest = await connect(`ws://127.0.0.1:${port}`);

    host.ws.send(JSON.stringify({ type: "create_room", gameId: "jungnim", nickname: "Host" }));
    const created = await host.wait((message) => message.type === "room_state") as Extract<ServerMessage, { type: "room_state" }>;
    guest.ws.send(JSON.stringify({ type: "join_room", code: created.code, nickname: "Guest" }));
    await host.wait((message) => message.type === "room_state" && message.players.length === 2);

    host.ws.send(JSON.stringify({ type: "start_game" }));
    await host.wait((message) => message.type === "game_start");
    await new Promise((resolve) => setTimeout(resolve, 25));
    host.ws.send(JSON.stringify({ type: "player_state", px: 10, py: 20 }));
    guest.ws.send(JSON.stringify({ type: "player_state", px: 30, py: 40 }));
    const snapshot = (await host.wait((message) => message.type === "peer_snapshot" && message.peers.length === 2)) as Extract<ServerMessage, { type: "peer_snapshot" }>;
    expect(snapshot.peers).toHaveLength(2);

    host.ws.send(JSON.stringify({ type: "player_died", survivalTicks: 1 }));
    guest.ws.send(JSON.stringify({ type: "player_died", survivalTicks: 1 }));
    const over = (await host.wait((message) => message.type === "game_over")) as Extract<ServerMessage, { type: "game_over" }>;
    expect(over.finalRanks).toHaveLength(2);

    host.ws.send(JSON.stringify({ type: "return_to_ready" }));
    const ready = (await host.wait((message) => message.type === "room_state" && message.state === "waiting")) as Extract<ServerMessage, { type: "room_state" }>;
    expect(ready.players).toHaveLength(2);
  });

  it("32명까지 입장시키고 33번째 참가자를 거절한다", async () => {
    const server = createArcadeServer({ port: 0, countdownMs: 10, snapshotMs: 20 });
    openServers.push(server);
    await once(server.wss, "listening");
    const port = (server.wss.address() as AddressInfo).port;
    const clients = await Promise.all(Array.from({ length: 33 }, () => connect(`ws://127.0.0.1:${port}`)));
    const host = clients[0];
    host.ws.send(JSON.stringify({ type: "create_room", gameId: "jungnim", nickname: "P0" }));
    const created = await host.wait((message) => message.type === "room_state") as Extract<ServerMessage, { type: "room_state" }>;

    for (let index = 1; index < 32; index++) {
      clients[index].ws.send(JSON.stringify({ type: "join_room", code: created.code, nickname: `P${index}` }));
      await host.wait((message) => message.type === "room_state" && message.players.length === index + 1);
    }
    clients[32].ws.send(JSON.stringify({ type: "join_room", code: created.code, nickname: "P32" }));
    const rejected = await clients[32].wait((message) => message.type === "error") as Extract<ServerMessage, { type: "error" }>;
    expect(rejected.reason).toContain("32명");
  });
});
