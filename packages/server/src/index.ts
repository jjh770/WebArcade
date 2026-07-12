/* ============================================================
   서버 진입점 — WebSocket(ws) 부팅
   ------------------------------------------------------------
   구현 단계에서 채울 것:
   - 메시지 라우팅 (ClientMessage 타입별 핸들러)
   - create_room / join_room / start_game / player_died / leave_room
   - 시드 배포: start_game 수신 시 seed + startTime(now+3000) 브로드캐스트
   - RankingService 연동
   ============================================================ */

import { WebSocketServer } from "ws";
import { RoomManager } from "./RoomManager";

const PORT = Number(process.env.PORT ?? 8080);
const wss = new WebSocketServer({ port: PORT });
const rooms = new RoomManager();
void rooms; // 구현 단계에서 사용

wss.on("connection", (socket) => {
  socket.on("message", (_data) => {
    // TODO: JSON 파싱 → ClientMessage로 좁히기 → 핸들러 분기
  });

  socket.on("close", () => {
    // TODO: 방에서 제거, 호스트 이양 처리
  });
});

console.log(`WebSocket 서버 실행 중: ws://localhost:${PORT}`);
