import { createArcadeServer } from "./ArcadeServer.js";

const port = Number(process.env.PORT ?? 8080);
createArcadeServer(port);
console.log(`WebSocket 서버 실행 중: ws://localhost:${port}`);
