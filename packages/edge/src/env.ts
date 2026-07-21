/* ============================================================
   Env — Worker/DO가 받는 바인딩
   ------------------------------------------------------------
   index.ts에 두면 RoomObject와 서로 import하게 되어 순환이 생긴다.
   ============================================================ */

export type Env = {
  /** wrangler.toml의 durable_objects 바인딩과 이름이 일치해야 한다. */
  ROOMS: DurableObjectNamespace;

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
