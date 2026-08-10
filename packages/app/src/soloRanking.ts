/* ============================================================
   soloRanking — 혼자 기록을 서버에 내고 순위를 받아온다
   ------------------------------------------------------------
   혼자 연습이 곧 랭킹 도전이다. 시작할 때 서버에서 **티켓**(시드 + 서명)을 받고,
   죽으면 그 티켓과 함께 기록을 낸다. 시드를 서버가 주는 이유는 두 가지다 —
   기록이 특정 한 판에 묶이고, 쉬운 시드가 나올 때까지 다시 뽑을 수 없다.

   ⚠️ **서버가 없어도 연습은 된다.** 이 모듈의 모든 실패는 null이고, 부르는 쪽은
      null이면 로컬 시드로 그냥 논다(그 판은 랭킹에 안 올라간다). 서버가 자고
      있다고 게임을 못 하게 되는 일은 없어야 한다 — 그래서 짧은 시간 안에
      대답이 없으면 기다리지 않고 끊는다.

   화면은 건드리지 않는다(roomConnect와 같은 규칙) — 무엇을 띄울지는 부르는 쪽이 정한다.
   ============================================================ */

import { HTTP_URL } from "./serverUrl";

/** 랭킹 도전 한 판의 시작 표. seed로 판을 돌리고, ticket으로 기록을 낸다. */
export type SoloTicket = { ticket: string; seed: number };

/** 순위표 한 줄. score의 단위는 게임이 정한다(ScoreUnit) — 화면이 formatGameScore로 붙인다. */
export type BoardRow = { nickname: string; score: number; at: number };

/** 기록 제출 결과. rank가 null이면 보드에 못 든 것(상한 밖). */
export type SoloRank = {
  rank: number | null;
  /** 이 닉네임의 서버 기준 최고 기록. 이번 판이 더 낮으면 예전 값. */
  best: number;
  isBest: boolean;
  total: number;
  entries: BoardRow[];
};

/** 티켓을 기다려 주는 한도(ms).
 *
 *  ⚠️ 이 값이 **서버가 죽었을 때 판이 늦게 뜨는 시간**이다. 닿지 않는 서버는 즉시
 *     거절되지 않고 이 한도를 꽉 채운다(로컬에서 2.4초 멈추는 걸 실제로 쟀다).
 *     그래서 넉넉하게 잡으면 안 된다 — 대부분은 미리 받아 두므로(main.ts의
 *     prefetchTicket) 이 한도를 기다리는 건 "고르자마자 바로 누른" 경우뿐이다. */
const TICKET_TIMEOUT_MS = 1200;

/** 제출은 결과창이 이미 뜬 뒤에 도착한다 — 여기서 조금 더 기다려도 손해가 없다. */
const SUBMIT_TIMEOUT_MS = 5000;

/** 순위표 조회. 화면에 "불러오는 중"을 띄워 둔 채 기다리므로 게임 시작보다는 여유가 있다. */
const BOARD_TIMEOUT_MS = 5000;

async function requestJson<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T | null> {
  try {
    const response = await fetch(`${HTTP_URL}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    // 400(서버가 기록을 거부함)도 여기서 null이 된다. 이유를 화면에 옮기지 않는 건
    // 정상적으로 논 사람에게는 절대 안 뜨는 메시지이기 때문이다 — 조용히 넘긴다.
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null; // 서버 없음·시간 초과·응답이 JSON이 아님 — 부르는 쪽에서는 다 같은 뜻이다.
  }
}

/** 랭킹 도전 한 판을 연다. 실패하면 null(= 이번 판은 랭킹에 올라가지 않는다). */
export function takeTicket(gameId: string): Promise<SoloTicket | null> {
  return requestJson<SoloTicket>(
    `/solo/ticket?gameId=${encodeURIComponent(gameId)}`,
    { method: "POST" },
    TICKET_TIMEOUT_MS,
  );
}

/** 게임 하나의 순위표를 읽는다. 서버에 닿지 못하면 null(빈 목록과 구분해야 한다 —
 *  "아직 아무도 없다"와 "못 불러왔다"는 화면에서 다르게 말해야 하기 때문). */
export async function fetchBoard(gameId: string): Promise<BoardRow[] | null> {
  const body = await requestJson<{ total: number; entries: BoardRow[] }>(
    `/solo/board?gameId=${encodeURIComponent(gameId)}`,
    { method: "GET" },
    BOARD_TIMEOUT_MS,
  );
  return body?.entries ?? null;
}

/** 기록을 낸다. 티켓은 일회용이라 같은 티켓으로 두 번 부르면 서버가 거부한다.
 *
 *  ⚠️ **0은 기록이 아니다 — 아예 보내지 않는다.** 숫자 야구에서 한 문제도 못 맞힌 판,
 *     회피 게임에서 시작하자마자 죽은 판이 여기 해당한다. 순위표는 닉네임당 한 줄이라
 *     0점짜리 줄이 남으면 이름만 차지하고, 그 사람이 다시 오기 전까지 순위표 아래쪽이
 *     "아무것도 안 한 판"으로 채워진다. 서버가 아니라 여기서 막는 이유는 이게 게임
 *     지식이 아니라 산수여서다 — 어느 게임에서든 0은 아무 일도 안 일어난 판이다. */
export function submitScore(ticket: string, nickname: string, score: number): Promise<SoloRank | null> {
  if (score <= 0) return Promise.resolve(null);
  return requestJson<SoloRank>(
    "/solo/score",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket, nickname, score }),
    },
    SUBMIT_TIMEOUT_MS,
  );
}
