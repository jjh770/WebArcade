/* ============================================================
   serverUrl — 게임 서버 주소 한 곳
   ------------------------------------------------------------
   방 접속(roomConnect)과 혼자 기록(soloRanking)이 같은 서버를 본다. 주소를
   양쪽에 두면 배포 때 한쪽만 바꾸는 사고가 나므로 여기 하나만 둔다.
   ============================================================ */

/** 게임 서버 주소(호스트까지만. 경로는 용도별로 붙인다).
 *  - 배포: VITE_WS_URL을 반드시 지정한다(예: wss://...). HTTPS 페이지에서 ws:// 로 붙으면
 *    브라우저가 mixed content로 차단하므로 wss:// 여야 한다.
 *  - 로컬 개발: 값이 없으면 같은 호스트의 8787(`npm run dev:server`)로 붙는다. */
export const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${location.hostname || "localhost"}:8787`;

/** HTTP로 하는 일(방 만들기·기록 제출)의 주소. 설정은 하나만 하도록 ws→http, wss→https로 유도한다. */
export const HTTP_URL = WS_URL.replace(/^ws/, "http");
