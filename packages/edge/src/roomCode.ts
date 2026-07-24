/* ============================================================
   roomCode — 방 코드 발급
   ------------------------------------------------------------
   ⚠️ 문자 집합은 클라의 입력 검증 정규식(`/^[A-HJ-NP-Z]{4}$/`, validation.ts)과
      맞물려 있다. 한쪽만 바꾸면 서버가 발급한 코드를 클라가 거부하는 조용한
      버그가 된다(테스트로 고정해 두었다).
      I·O가 빠진 것은 1·0과 헷갈려서다 — 코드를 말로 불러줄 일이 많다.

   난수는 Web Crypto를 쓴다(Workers에는 node:crypto가 없다). 게임 로직이 아니라
   방 이름을 고르는 자리라 결정론 불변식과는 무관하다.
   ============================================================ */

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 4;

export function generateRoomCode(): string {
  const raw = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(raw);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[raw[i]! % CODE_CHARS.length];
  return code;
}
