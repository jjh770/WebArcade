/* ============================================================
   Vitest 설정 — 두 종류의 테스트를 각자 맞는 런타임에서 돌린다
   ------------------------------------------------------------
   · unit  : 결정론·FSM·방 로직 등 순수 로직. 평범한 Node에서 돈다.
   · edge  : 서버 전송 계층(Durable Object·WebSocket·alarm).
             workerd(실제 Workers 런타임) 안에서 돌아야 의미가 있다 —
             Node로 흉내 내면 하이버네이션도 알람도 검증되지 않는다.

   `npm test`는 둘 다 실행한다.

   ⚠️ vitest 4부터 `cloudflareTest`는 **플러그인**이다(3.x의
      `defineWorkersProject` + `test.poolOptions.workers`를 대체).
   ============================================================ */

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest({
            // 실제 배포와 같은 설정(DO 바인딩·마이그레이션)을 그대로 쓴다.
            wrangler: { configPath: "./packages/edge/wrangler.toml" },
            miniflare: {
              // 유예 만료를 몇 초 안에 확인하려고 짧게 준다(운영 기본값은 60초).
              bindings: { ROOM_GRACE_MS: "1000" },
            },
          }),
        ],
        test: {
          name: "edge",
          include: ["packages/edge/test/**/*.test.ts"],
        },
      },
    ],
  },
});
