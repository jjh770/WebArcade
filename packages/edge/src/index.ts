/* ============================================================
   edge — Cloudflare Workers 진입점 (이식 중, 아직 방 기능 없음)
   ------------------------------------------------------------
   기존 `packages/server`(node + ws)를 Workers + Durable Objects로 옮기는
   작업의 1단계. 지금은 헬스체크만 답한다.

   ⚠️ 이식이 끝나기 전까지 `packages/server`가 여전히 현역이다.
      로컬 개발(`npm run dev:server`)과 테스트가 그쪽을 쓴다. 지우지 말 것.

   왜 옮기는가: 방 상태가 `RoomManager`의 Map(프로세스 메모리)에 있어
   "서버 머신은 반드시 1대"라는 제약이 있다(DESIGN 9절). Durable Objects는
   방 하나 = 오브젝트 하나라 그 제약이 사라진다. (DESIGN 10절)
   ============================================================ */

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 배포 플랫폼이 "살아있음"을 확인하는 경로. 기존 서버와 같은 응답을 유지한다
    // — 이식 전후로 헬스체크 방식이 달라지지 않게.
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler;
