/* ============================================================
   adminAuth — 운영자 요청인지 가리는 한 가지 판단
   ------------------------------------------------------------
   순위표에서 기록을 지우는 경로에만 쓴다. 게임을 하는 모든 경로는 지금도
   앞으로도 인증이 없다 — 여기 있는 건 "지우기"라는 **되돌릴 수 없는 일**
   하나를 위한 문이다.

   계정도 세션도 만들지 않는다. 운영자가 한 명이라 열쇠 하나로 충분하고,
   그 열쇠는 `wrangler secret put ADMIN_KEY`로 심는다(env.ts 주석).

   index.ts가 아니라 따로 둔 이유: 열쇠 비교는 실수하면 조용히 뚫리는
   종류라 테스트가 붙어야 하는데, index.ts는 Workers 런타임 없이는 못
   불러온다. 여기는 순수 함수뿐이라 Node에서 그대로 확인할 수 있다.
   ============================================================ */

import type { Env } from "./env";

/** 두 문자열이 같은가 — 길이가 같으면 **끝까지** 비교한다.
 *  틀린 글자에서 바로 빠져나오면 응답 시간 차이로 열쇠를 한 글자씩 알아낼 수 있다
 *  (맞는 접두사가 길수록 조금 느려지므로, 앞에서부터 한 글자씩 맞춰 나갈 수 있다). */
export function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** 운영자 요청인가. 열쇠가 안 심긴 배포에서는 **아무도** 통과하지 못한다 —
 *  설정을 빠뜨렸을 때 문이 열린 채 남는 대신 아예 잠기는 쪽으로 넘어진다. */
export function isAdmin(env: Env, request: Request): boolean {
  if (!env.ADMIN_KEY) return false;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  return sameSecret(given, env.ADMIN_KEY);
}
