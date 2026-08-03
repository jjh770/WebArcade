/* ============================================================
   roomConnect — 서버 주소와 방 접속 절차
   ------------------------------------------------------------
   ⚠️ 서버는 **방마다 인스턴스가 따로다**(Durable Object). 그래서 "접속한 뒤 방을
   고른다"가 불가능하다 — 코드를 먼저 받고(HTTP), 그 코드로 접속한다(WebSocket).
   방을 옮기려면 연결부터 새로 맺어야 한다. 이 절차 전체가 여기 모여 있다.

   화면(토스트·상태)은 건드리지 않는다. 성공/실패만 돌려주고 무엇을 띄울지는
   부르는 쪽이 정한다 — 그래야 이 파일이 앱 상태를 몰라도 된다.
   ============================================================ */

import type { NetClient } from "@arcade/core";

/** 게임 서버 주소(호스트까지만. 경로는 용도별로 붙인다).
 *  - 배포: VITE_WS_URL을 반드시 지정한다(예: wss://...). HTTPS 페이지에서 ws:// 로 붙으면
 *    브라우저가 mixed content로 차단하므로 wss:// 여야 한다.
 *  - 로컬 개발: 값이 없으면 같은 호스트의 8787(`npm run dev:server`)로 붙는다. */
const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${location.hostname || "localhost"}:8787`;

/** 방 만들기만 HTTP다. 주소는 하나만 설정하면 되도록 ws→http, wss→https로 유도한다. */
const HTTP_URL = WS_URL.replace(/^ws/, "http");

/** 방 코드 형식. I·O는 1·0과 헷갈려 빠져 있다(서버가 만드는 규칙과 같다). */
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z]{4}$/;

/** 새 방을 만들고 코드를 받는다. 실패하면 null. */
export async function createRoom(gameId: string): Promise<string | null> {
  try {
    const response = await fetch(`${HTTP_URL}/rooms?gameId=${encodeURIComponent(gameId)}`, { method: "POST" });
    if (!response.ok) return null;
    const { code } = (await response.json()) as { code: string };
    return code;
  } catch {
    return null;
  }
}

/** 방 코드로 접속하고 참가까지 마친다. 접속에 실패하면 false. */
export async function joinRoom(net: NetClient, code: string, nickname: string): Promise<boolean> {
  try {
    await net.connect(`${WS_URL}/ws?code=${code}`);
  } catch {
    return false;
  }
  net.send({ type: "join_room", code, nickname });
  return true;
}
