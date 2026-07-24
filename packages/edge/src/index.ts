/* ============================================================
   edge — 게임 서버 (Cloudflare Workers + Durable Objects)
   ------------------------------------------------------------
   헬스체크 / 방 코드 발급 / WebSocket을 방 오브젝트로 라우팅한다.
   서버는 게임 내용을 모른다 — 방·시드·순위만 다룬다.

   ⚠️ **방 코드를 연결 시점에 알아야 한다.** WebSocket이 어느 오브젝트로 갈지는
      URL로 정해지고, 한번 붙은 소켓은 다른 오브젝트로 옮길 수 없다. 그래서
      "연결한 뒤 방을 만든다"가 불가능하고, 방 만들기는 HTTP(`POST /rooms`)로
      코드를 먼저 받아 그 코드로 접속하는 2단계다. (DESIGN 10절)

   방 하나 = Durable Object 하나이므로 인스턴스를 몇 개 띄우든 같은 코드는 같은
   방으로 모인다 — 방 상태를 프로세스 메모리에 두던 시절의 "서버는 반드시 1대"
   제약이 없다.
   ============================================================ */

import type { Env } from "./env";
import { RoomObject } from "./RoomObject";
import { generateRoomCode } from "./roomCode";
import { GAME_ID } from "./validation";

export type { Env };

// wrangler가 마이그레이션에서 이 이름을 찾는다 — 반드시 export.
export { RoomObject };

/** 프론트(Vercel)와 서버(Workers)는 출처가 다르다. 방 만들기가 WebSocket이 아니라
 *  HTTP fetch가 되면서 CORS가 필요해졌다 — 이 헤더가 없으면 브라우저가 응답 읽기를
 *  막아 "방을 만들 수 없습니다"만 뜬다(요청 자체는 서버에 도달하는데도).
 *
 *  `*`로 열어 둔다: 인증도 쿠키도 없는 공개 API이고, 출처를 좁혀도 서버를 보호하지
 *  못한다(브라우저 밖에서는 CORS가 적용되지 않는다). 남용 방어는 rate limit의 몫. */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
} as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

/** 코드가 겹치면 다시 뽑는다. 24^4 = 331,776가지라 실제로는 거의 안 겹친다. */
const MAX_CODE_ATTEMPTS = 8;

/** 방 오브젝트에 거는 내부 요청의 기준 URL. 호스트는 의미가 없다(스텁이 직접 받는다). */
const DO_ORIGIN = "https://room";

async function createRoom(env: Env, gameId: string): Promise<Response> {
  if (!GAME_ID.test(gameId)) {
    return json({ reason: "유효하지 않은 게임입니다." }, 400);
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    // 선점은 오브젝트 안에서 판단한다 — 중앙 Map이 없으니 "이미 쓰는 코드인가"를
    // 물어볼 곳이 그 오브젝트 자신뿐이다. 409면 다른 코드로 재시도.
    const claimed = await stub.fetch(`${DO_ORIGIN}/claim?code=${code}&gameId=${encodeURIComponent(gameId)}`);
    if (claimed.ok) return json({ code });
  }

  return json({ reason: "방 코드를 발급하지 못했습니다." }, 503);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 배포 플랫폼과 모니터링이 "살아있음"을 확인하는 경로.
    if (url.pathname === "/health") {
      return json({ ok: true });
    }

    // 프리플라이트. 지금 클라의 방 만들기는 헤더 없는 단순 POST라 여기까지 오지
    // 않지만, 나중에 헤더가 붙으면 브라우저가 먼저 이걸 물어본다.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
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
