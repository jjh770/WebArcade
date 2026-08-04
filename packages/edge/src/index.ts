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

import { isAdmin } from "./adminAuth";
import { BoardObject, BOARD_NAME } from "./BoardObject";
import type { Env } from "./env";
import { RoomObject } from "./RoomObject";
import { generateRoomCode } from "./roomCode";
import { GAME_ID } from "./validation";

export type { Env };

// wrangler가 마이그레이션에서 이 이름을 찾는다 — 반드시 export.
export { RoomObject, BoardObject };

/** 프론트(Vercel)와 서버(Workers)는 출처가 다르다. 방 만들기가 WebSocket이 아니라
 *  HTTP fetch가 되면서 CORS가 필요해졌다 — 이 헤더가 없으면 브라우저가 응답 읽기를
 *  막아 "방을 만들 수 없습니다"만 뜬다(요청 자체는 서버에 도달하는데도).
 *
 *  `*`로 열어 둔다: 인증도 쿠키도 없는 공개 API이고, 출처를 좁혀도 서버를 보호하지
 *  못한다(브라우저 밖에서는 CORS가 적용되지 않는다). 남용 방어는 rate limit의 몫. */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  // 기록 제출은 JSON 본문이라 content-type이 붙는다 — 이걸 빼면 브라우저가
  // 프리플라이트에서 막아 요청 자체가 나가지 않는다.
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
} as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

/** 코드가 겹치면 다시 뽑는다. 24^4 = 331,776가지라 실제로는 거의 안 겹친다. */
const MAX_CODE_ATTEMPTS = 8;

/** 방 오브젝트에 거는 내부 요청의 기준 URL. 호스트는 의미가 없다(스텁이 직접 받는다). */
const DO_ORIGIN = "https://room";
const BOARD_ORIGIN = "https://board";

/** 혼자 기록 요청을 보드 오브젝트로 넘기고 응답에 CORS를 입힌다.
 *  오브젝트는 브라우저와 직접 말하지 않으므로 CORS를 모른다 — 그 일은 여기 몫이다. */
async function forwardToBoard(env: Env, path: string, request: Request): Promise<Response> {
  const stub = env.BOARD.get(env.BOARD.idFromName(BOARD_NAME));
  const response = await stub.fetch(new Request(`${BOARD_ORIGIN}${path}`, request));
  return new Response(response.body, {
    status: response.status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

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

    // 혼자 기록 랭킹. 게임 id는 여기서 형식을 걸러 오브젝트로 넘긴다
    // (없는 게임 이름으로 빈 보드가 무한히 생기는 걸 막는다).
    if (url.pathname.startsWith("/solo/")) {
      const gameId = url.searchParams.get("gameId") ?? "";
      if (url.pathname === "/solo/ticket" && request.method === "POST") {
        if (!GAME_ID.test(gameId)) return json({ reason: "유효하지 않은 게임입니다." }, 400);
        return forwardToBoard(env, `/ticket?gameId=${encodeURIComponent(gameId)}`, request);
      }
      // 기록 제출에는 gameId가 없다 — 어느 게임인지는 티켓 서명 안에 들어 있다.
      if (url.pathname === "/solo/score" && request.method === "POST") {
        return forwardToBoard(env, "/score", request);
      }
      if (url.pathname === "/solo/board" && request.method === "GET") {
        if (!GAME_ID.test(gameId)) return json({ reason: "유효하지 않은 게임입니다." }, 400);
        return forwardToBoard(env, `/board?gameId=${encodeURIComponent(gameId)}`, request);
      }
      // 기록 지우기(운영자). 열쇠가 틀리면 **404** — 401이면 "여기 뭔가 있다"를
      // 알려주는 셈이라, 열쇠 없는 사람에게는 이 경로가 없는 것과 똑같이 보이게 한다.
      if (url.pathname === "/solo/entry" && request.method === "DELETE") {
        if (!isAdmin(env, request)) return new Response("Not Found", { status: 404 });
        if (!GAME_ID.test(gameId)) return json({ reason: "유효하지 않은 게임입니다." }, 400);
        const nickname = encodeURIComponent(url.searchParams.get("nickname") ?? "");
        return forwardToBoard(env, `/remove?gameId=${encodeURIComponent(gameId)}&nickname=${nickname}`, request);
      }
      // 이름만 바꾸기(운영자). 지우기와 달리 되돌릴 수 있어, 욕설 닉네임에는 이쪽이 먼저다.
      if (url.pathname === "/solo/entry" && request.method === "PATCH") {
        if (!isAdmin(env, request)) return new Response("Not Found", { status: 404 });
        if (!GAME_ID.test(gameId)) return json({ reason: "유효하지 않은 게임입니다." }, 400);
        const from = encodeURIComponent(url.searchParams.get("from") ?? "");
        const to = encodeURIComponent(url.searchParams.get("to") ?? "");
        return forwardToBoard(env, `/rename?gameId=${encodeURIComponent(gameId)}&from=${from}&to=${to}`, request);
      }
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
