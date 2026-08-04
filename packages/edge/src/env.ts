/* ============================================================
   Env — Worker/DO가 받는 바인딩
   ------------------------------------------------------------
   index.ts에 두면 RoomObject와 서로 import하게 되어 순환이 생긴다.
   ============================================================ */

export type Env = {
  /** wrangler.toml의 durable_objects 바인딩과 이름이 일치해야 한다. */
  ROOMS: DurableObjectNamespace;

  /** 혼자 기록 랭킹. 방과 달리 오브젝트는 전 세계에 하나뿐이다(BoardObject 주석). */
  BOARD: DurableObjectNamespace;

  /** 순위표에서 기록을 지울 때 요구하는 열쇠(`wrangler secret put ADMIN_KEY`).
   *  **ASCII로 짓는다** — 헤더에 실려 오는데 헤더는 Latin-1만 담는다(한글 열쇠는
   *  보내는 쪽에서 요청을 만들다 실패한다).
   *
   *  ⚠️ **없으면 삭제 경로가 통째로 사라진다**(404). 열쇠를 안 심은 배포에서
   *     무방비 삭제 엔드포인트가 열려 있는 상태가 생기지 않게 하려는 것이다 —
   *     빠뜨렸을 때 안전한 쪽으로 넘어져야 한다. */
  ADMIN_KEY?: string;

  /** 빈 방을 남겨두는 시간(ms). 기존 서버의 ROOM_GRACE_MS와 같은 뜻.
   *  환경변수는 문자열로 오므로 숫자로 바꿔 쓴다. 검증에서 짧게 줄여
   *  만료를 실제로 확인하려고 설정 가능하게 뒀다(기본 60초). */
  ROOM_GRACE_MS?: string;
};

const DEFAULT_ROOM_GRACE_MS = 60_000;

export function roomGraceMs(env: Env): number {
  const parsed = Number(env.ROOM_GRACE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ROOM_GRACE_MS;
}
