/* ============================================================
   roomCode — 방 코드 발급 (기존 RoomManager.generateCode 이식)
   ------------------------------------------------------------
   문자 집합과 길이는 기존 서버와 **똑같이 유지한다**. 클라의 입력 검증
   정규식(`/^[A-HJ-NP-Z]{4}$/`)과 맞물려 있어 한쪽만 바꾸면 조용히 깨진다.
   (I·O는 1·0과 헷갈려서 애초에 빠져 있다.)

   node:crypto의 randomInt를 쓸 수 없어 Web Crypto로 바꿨다 — Workers에는
   node 모듈이 없다. 결정론과는 무관한 자리다(게임 로직이 아니라 방 이름).
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
