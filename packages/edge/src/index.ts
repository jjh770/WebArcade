/* ============================================================
   edge — Cloudflare Workers 진입점 (이식 중)
   ------------------------------------------------------------
   기존 `packages/server`(node + ws)를 Workers + Durable Objects로 옮기는 작업.
   현재까지: 헬스체크 / 방 코드 발급 / WebSocket을 방 오브젝트로 라우팅.

   ⚠️ 이식이 끝나기 전까지 `packages/server`가 여전히 현역이다.
      로컬 개발(`npm run dev:server`)과 테스트가 그쪽을 쓴다. 지우지 말 것.

   ⚠️ 기존 서버와 달리 **방 코드를 연결 시점에 알아야 한다.** WebSocket이 어느
      오브젝트로 갈지는 URL로 정해지고, 한번 붙은 소켓은 다른 오브젝트로 옮길 수
      없다. 기존처럼 "연결한 뒤 create_room 메시지로 방을 만든다"가 불가능해서,
      방 만들기는 HTTP(`POST /rooms`)로 코드를 먼저 받고 그 코드로 접속한다.
      → 클라(NetClient)도 이 흐름에 맞춰 바뀌어야 한다. (DESIGN 10절)

   왜 옮기는가: 방 상태가 `RoomManager`의 Map(프로세스 메모리)에 있어
   "서버 머신은 반드시 1대"라는 제약이 있다(DESIGN 9절). Durable Objects는
   방 하나 = 오브젝트 하나라 그 제약이 사라진다.
   ============================================================ */

import type { Env } from "./env";
import { RoomObject } from "./RoomObject";
import { generateRoomCode } from "./roomCode";
import { GAME_ID } from "./validation";

export type { Env };

// wrangler가 마이그레이션에서 이 이름을 찾는다 — 반드시 export.
export { RoomObject };

/** 코드가 겹치면 다시 뽑는다. 24^4 = 331,776가지라 실제로는 거의 안 겹친다. */
const MAX_CODE_ATTEMPTS = 8;

/** 방 오브젝트에 거는 내부 요청의 기준 URL. 호스트는 의미가 없다(스텁이 직접 받는다). */
const DO_ORIGIN = "https://room";

async function createRoom(env: Env, gameId: string): Promise<Response> {
  if (!GAME_ID.test(gameId)) {
    return Response.json({ reason: "유효하지 않은 게임입니다." }, { status: 400 });
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    // 선점은 오브젝트 안에서 판단한다 — 중앙 Map이 없으니 "이미 쓰는 코드인가"를
    // 물어볼 곳이 그 오브젝트 자신뿐이다. 409면 다른 코드로 재시도.
    const claimed = await stub.fetch(`${DO_ORIGIN}/claim?code=${code}&gameId=${encodeURIComponent(gameId)}`);
    if (claimed.ok) return Response.json({ code });
  }

  return Response.json({ reason: "방 코드를 발급하지 못했습니다." }, { status: 503 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 배포 플랫폼이 "살아있음"을 확인하는 경로. 기존 서버와 같은 응답을 유지한다
    // — 이식 전후로 헬스체크 방식이 달라지지 않게.
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/rooms" && request.method === "POST") {
      return createRoom(env, url.searchParams.get("gameId") ?? "");
    }

    if (url.pathname === "/ws") {
      // 방 코드 → 오브젝트 하나. 같은 코드는 어느 지역에서 접속하든 같은
      // 오브젝트로 간다 — 이게 "머신 1대" 제약을 없애는 핵심이다.
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing room code", { status: 400 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
