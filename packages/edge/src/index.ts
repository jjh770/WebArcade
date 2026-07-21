/* ============================================================
   edge — Cloudflare Workers 진입점 (이식 중, 아직 방 기능 없음)
   ------------------------------------------------------------
   기존 `packages/server`(node + ws)를 Workers + Durable Objects로 옮기는
   작업. 2단계까지: 헬스체크 + WebSocket을 방 오브젝트로 넘기기(에코).

   ⚠️ 이식이 끝나기 전까지 `packages/server`가 여전히 현역이다.
      로컬 개발(`npm run dev:server`)과 테스트가 그쪽을 쓴다. 지우지 말 것.

   왜 옮기는가: 방 상태가 `RoomManager`의 Map(프로세스 메모리)에 있어
   "서버 머신은 반드시 1대"라는 제약이 있다(DESIGN 9절). Durable Objects는
   방 하나 = 오브젝트 하나라 그 제약이 사라진다. (DESIGN 10절)
   ============================================================ */

import { RoomObject } from "./RoomObject";

/** wrangler.toml의 durable_objects 바인딩과 이름이 일치해야 한다. */
export type Env = {
  ROOMS: DurableObjectNamespace;
};

// wrangler가 마이그레이션에서 이 이름을 찾는다 — 반드시 export.
export { RoomObject };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 배포 플랫폼이 "살아있음"을 확인하는 경로. 기존 서버와 같은 응답을 유지한다
    // — 이식 전후로 헬스체크 방식이 달라지지 않게.
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/ws") {
      // 방 코드 → 오브젝트 하나. 같은 코드는 어느 지역에서 접속하든 같은
      // 오브젝트로 간다 — 이게 "머신 1대" 제약을 없애는 핵심이다.
      // (3단계에서 진짜 방 코드 체계로 교체. 지금은 없으면 LOBBY로 묶는다.)
      const code = url.searchParams.get("code") ?? "LOBBY";
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
