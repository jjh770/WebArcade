/* ============================================================
   soloRules — 혼자 기록의 판정 규칙 (순수 함수)
   ------------------------------------------------------------
   혼자 연습은 서버가 판을 중계하지 않는다. 그래서 기록은 **자기신고**이고,
   서버가 쥘 수 있는 근거는 두 가지뿐이다.

     1. 시드를 서버가 발급했다      → 그 판이 언제 시작됐는지 안다
     2. 시각은 서버 시계로 잰다     → "그만큼 시간이 흐르긴 했나"를 볼 수 있다

   그래서 랭킹 도전은 **티켓**으로 묶는다. 시작할 때 서버가 `{게임, 시드,
   발급시각, 일련번호}`에 서명해 주고, 기록을 낼 때 그 티켓을 함께 낸다.
   서명이 있으니 내용을 고칠 수 없고, 일련번호가 있으니 한 티켓으로 두 번
   낼 수 없고, 발급시각이 있으니 "1초 만에 10분을 버텼다"가 걸린다.

   ⚠️ 이걸로 막히는 건 **날조**뿐이다. 일찍 죽고 그만큼 기다렸다 신고하는 건
      여전히 통한다 — 그걸 막으려면 서버가 게임을 실제로 돌려 봐야 하고,
      그건 "서버는 게임을 모른다"는 원칙을 깬다(DESIGN 10절). 실제 조작이
      관측되면 그때 리플레이 검증을 재고한다.

   여기에는 시계도 저장소도 암호도 없다 — 전부 인자로 받는다. 서명과 저장은
   BoardObject의 몫이다.
   ============================================================ */

/** 티켓에 서명해 담는 내용. 짧은 키를 쓰는 건 티켓이 URL·본문에 실려 다니기 때문. */
export type TicketPayload = {
  /** 게임 id. 이걸 서명에 넣어야 죽림고수 기록을 커브 피버 보드에 낼 수 없다. */
  g: string;
  /** 서버가 뽑아 준 시드. 클라는 반드시 이 시드로 판을 돌린다. */
  s: number;
  /** 발급 시각(ms, 서버 시계). 경과시간 검사의 기준점. */
  t: number;
  /** 일회용 일련번호. 같은 티켓의 두 번째 제출을 막는다. */
  n: string;
};

/** 보드 한 줄. 닉네임은 소유권이 없으므로 신원이 아니라 표시용 이름일 뿐이다.
 *  score의 **단위는 여기 없다** — 게임에 따라 생존 tick이거나 점수다(ScoreUnit).
 *  보드는 크기로 줄만 세우고, 단위를 붙이는 건 화면이다. */
export type BoardEntry = {
  nickname: string;
  score: number;
  /** 기록이 등록된 시각(ms). 동점 정렬과 표시에 쓴다. */
  at: number;
};

/** 티켓의 유효기간. 이보다 오래된 티켓은 받지 않는다 — 미리 잔뜩 받아 두었다가
 *  나중에 몰아 내는 걸 막고, 일련번호 보관 기간도 이만큼으로 끝난다. */
export const TICKET_TTL_MS = 30 * 60_000;

/** 신고 생존시간이 실제 경과시간을 넘어도 봐주는 폭(ms).
 *  발급 → 카운트다운 → 플레이 순이라 실제로는 경과가 항상 더 길다. 이 여유는
 *  네트워크 왕복과 시계 오차용이다. */
export const CLAIM_TOLERANCE_MS = 2000;

/** 게임마다 보관하는 줄 수. 넘치면 아래부터 버린다. */
export const BOARD_LIMIT = 50;

const TICKS_PER_SECOND = 60;

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

/** 서명 대상이 되는 문자열. 서명과 검증이 **같은 바이트**를 봐야 하므로,
 *  payload를 다시 JSON.stringify 하지 않고 이 문자열을 그대로 티켓에 담는다. */
export function encodePayload(payload: TicketPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

export function decodePayload(encoded: string): TicketPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(encoded));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { g, s, t, n } = parsed as Record<string, unknown>;
  if (typeof g !== "string" || g.length === 0) return null;
  if (!Number.isFinite(s) || !Number.isFinite(t)) return null;
  if (typeof n !== "string" || n.length === 0) return null;
  return { g, s: Number(s), t: Number(t), n };
}

export type ClaimCheck = { ok: true } | { ok: false; reason: string };

/** 이 티켓으로 이 기록을 낼 수 있는가. 서명 검증과 일련번호 소진 확인은
 *  호출자(BoardObject)가 이미 끝냈다고 본다 — 여기서는 시간 산수만 한다. */
export function checkClaim(payload: TicketPayload, score: number, now: number): ClaimCheck {
  if (!Number.isSafeInteger(score) || score < 0) {
    return { ok: false, reason: "유효하지 않은 기록입니다." };
  }
  const age = now - payload.t;
  if (age < 0 || age > TICKET_TTL_MS) {
    return { ok: false, reason: "기록 티켓이 만료되었습니다. 다시 시작해 주세요." };
  }
  // ⚠️ 여기서만 서버가 **기록을 tick이라고 가정한다.** 신고값을 초로 바꿔 경과시간과 견주는데,
  //    기록이 점수인 게임(숫자 야구)에서는 이 비교가 사실상 아무것도 막지 못한다
  //    (티켓 TTL이 30분이라 산술상 10만점대까지 통과한다). 고치려면 단위를 서버까지 흘려야
  //    하므로 따로 다룬다 — RoomObject의 SURVIVAL_TOLERANCE_TICKS에 같은 가정이 하나 더 있다.
  const claimedMs = (score / TICKS_PER_SECOND) * 1000;
  if (claimedMs > age + CLAIM_TOLERANCE_MS) {
    return { ok: false, reason: "유효하지 않은 기록입니다." };
  }
  return { ok: true };
}

/** 보드에 한 줄을 반영한 결과.
 *  `rank`는 반영 뒤 이 닉네임의 자리(1부터). 상한 밖으로 밀려나면 null. */
export type InsertResult = {
  board: BoardEntry[];
  rank: number | null;
  /** 반영 뒤 이 닉네임의 최고 기록. 이번 판이 더 낮으면 예전 값이 남는다. */
  best: number;
  /** 이번 판이 그 닉네임의 최고 기록을 갈아치웠는가. */
  isBest: boolean;
};

/** 한 줄을 넣고 다시 줄 세운다.
 *
 *  같은 닉네임은 **최고 기록 하나만** 남긴다. 닉네임은 소유권이 없어서 어차피
 *  신원이 아니지만, 한 사람이 보드를 자기 기록으로 도배하는 것만은 막는다.
 *  동점이면 먼저 세운 쪽이 위 — 나중에 온 사람이 앞지르지 못한다. */
export function insertEntry(
  board: readonly BoardEntry[],
  entry: BoardEntry,
  limit = BOARD_LIMIT,
): InsertResult {
  const previous = board.find((row) => row.nickname === entry.nickname);
  const isBest = !previous || entry.score > previous.score;
  const kept = isBest ? entry : (previous as BoardEntry);

  const merged = [...board.filter((row) => row.nickname !== entry.nickname), kept]
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, limit);

  const index = merged.indexOf(kept);
  return { board: merged, rank: index >= 0 ? index + 1 : null, best: kept.score, isBest };
}

/** 한 줄을 지운다(운영자용). 등수는 저장하지 않고 순서에서 나오므로,
 *  빼기만 하면 아래 줄들이 저절로 한 칸씩 올라온다.
 *
 *  ⚠️ 되돌릴 수 없다 — 지운 기록을 어디에도 남기지 않는다. 이력을 남기면 그건
 *     "지워진 순위표"라는 또 하나의 보관물이 되고, 그걸 관리할 이유가 없다. */
export function removeEntry(
  board: readonly BoardEntry[],
  nickname: string,
): { board: BoardEntry[]; removed: number } {
  const kept = board.filter((row) => row.nickname !== nickname);
  return { board: kept, removed: board.length - kept.length };
}

export type RenameResult =
  | { ok: true; board: BoardEntry[] }
  /** `reason`이 있으면 실패다. 못 찾음과 이름 충돌을 나누지 않고 문장으로 구분한다. */
  | { ok: false; reason: string };

/** 한 줄의 이름만 바꾼다(운영자용). 기록·시각은 건드리지 않으므로 등수도 그대로다.
 *
 *  욕설 닉네임에는 지우기보다 이쪽이 맞다 — 기록을 세운 것 자체는 잘못이 아닐 수
 *  있고, 지우면 순위표에 구멍이 생기지만 이름만 바꾸면 등수가 남는다. 무엇보다
 *  **되돌릴 수 있다**(다시 바꾸면 된다).
 *
 *  ⚠️ 이미 있는 이름으로는 바꾸지 않는다. 닉네임당 한 줄 규칙(insertEntry)대로
 *     합치면 조용히 한 줄이 사라지는데, 운영자가 시킨 적 없는 삭제다. */
export function renameEntry(
  board: readonly BoardEntry[],
  from: string,
  to: string,
): RenameResult {
  if (!board.some((row) => row.nickname === from)) {
    return { ok: false, reason: "그 이름이 순위표에 없습니다." };
  }
  if (from !== to && board.some((row) => row.nickname === to)) {
    return { ok: false, reason: "그 이름은 이미 순위표에 있습니다. 다른 이름을 쓰세요." };
  }
  return { ok: true, board: board.map((row) => (row.nickname === from ? { ...row, nickname: to } : row)) };
}
