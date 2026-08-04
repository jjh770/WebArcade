/* ============================================================
   board — 순위표 들여다보고 지우는 운영 도구
   ------------------------------------------------------------
   관리자 화면을 만들지 않은 이유: 운영자가 한 명이고, 그 한 명은 이미
   이 저장소가 있는 컴퓨터 앞에 있다. 로그인·세션·화면을 만드는 값이
   명령 두 개보다 크지 않다. 나중에 폰에서 지우고 싶어지면 그때 화면을
   얹으면 되고, 그 화면도 여기와 **같은 엔드포인트**를 쓴다.

     node scripts/board.mjs ls 커브게임id
     node scripts/board.mjs rm 커브게임id 닉네임

   열쇠(ADMIN_KEY)는 세 곳에서 찾는다 — 환경변수 → 저장소 루트의
   `.admin-key` 파일(깃 제외) → 직접 입력. 파일에 한 번 넣어 두는 걸
   권한다. 명령줄 인자로 받지 않는 건 셸 기록에 남기 때문이다.

   ⚠️ 열쇠는 **ASCII**로 짓는다. 헤더는 Latin-1만 담을 수 있어서 한글이
      섞이면 서버에 닿지도 못하고 여기서 요청을 만들다 터진다.
   ============================================================ */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/** 배포된 게임 서버. 로컬 서버로 시험할 때는 ARCADE_SERVER=http://localhost:8787 로 덮는다. */
const SERVER = process.env.ARCADE_SERVER ?? "https://webarcade.leon770.workers.dev";
const KEY_FILE = new URL("../.admin-key", import.meta.url);

/** 순위표가 있는 게임 전부. `rm all`이 훑는 대상이다.
 *  ⚠️ 게임을 추가하면 여기도 추가한다 — 서버에 "게임 목록"을 묻는 경로가 없어서
 *     (서버는 gameId를 문자열로만 다룬다) 클라가 알 방법이 없다. */
const GAMES = ["jungnim", "curve", "floor"];

const USAGE = `사용법:
  node scripts/board.mjs ls <게임id>              순위표 보기
  node scripts/board.mjs rm <게임id> <닉네임>      기록 지우기 (되돌릴 수 없음)
  node scripts/board.mjs rm all <닉네임>          세 게임에서 한꺼번에 지우기
  node scripts/board.mjs mv <게임id> <옛이름> <새이름>   이름만 바꾸기 (기록·등수 유지)

게임id: ${GAMES.join(" | ")}
서버:   ${SERVER}`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function adminKey() {
  let key = process.env.ADMIN_KEY?.trim();
  if (!key) {
    try {
      key = readFileSync(KEY_FILE, "utf8").trim();
    } catch {
      // 파일이 없다 — 물어본다. 화면에 보이지만 셸 기록에는 안 남는다.
      const rl = createInterface({ input: stdin, output: stdout });
      key = (await rl.question("ADMIN_KEY: ")).trim();
      rl.close();
    }
  }
  // 여기서 걸러 주지 않으면 fetch가 "ByteString" 어쩌고로 죽어 원인이 안 보인다.
  if (/[^\x20-\x7e]/.test(key)) fail("열쇠에 ASCII가 아닌 문자가 있습니다 — 영문·숫자·기호로 지어 주세요.");
  return key;
}

function printBoard(entries) {
  if (entries.length === 0) {
    console.log("(비어 있음)");
    return;
  }
  entries.forEach((row, i) => {
    const when = new Date(row.at).toLocaleString("ko-KR");
    console.log(`${String(i + 1).padStart(3)}. ${row.nickname}  ${(row.ticks / 60).toFixed(1)}s  ${when}`);
  });
}

async function list(gameId) {
  const response = await fetch(`${SERVER}/solo/board?gameId=${encodeURIComponent(gameId)}`);
  const body = await response.json();
  if (!response.ok) fail(`실패(${response.status}): ${body.reason ?? ""}`);
  console.log(`${gameId} — 총 ${body.total}줄`);
  printBoard(body.entries);
}

/** 한 게임에서 한 줄 지우기. 지운 수를 돌려준다(없으면 0). */
async function removeOne(gameId, nickname, key) {
  const query = `gameId=${encodeURIComponent(gameId)}&nickname=${encodeURIComponent(nickname)}`;
  const response = await fetch(`${SERVER}/solo/entry?${query}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${key}` },
  });
  // 열쇠가 틀리면 서버가 404를 준다(경로를 감춘다) — 그래서 404는 "없는 주소"가 아니라
  // 대개 "열쇠가 틀렸다"다. 사용자에게 둘 다 짚어 준다.
  if (response.status === 404) fail("거부됐습니다 — 열쇠가 틀렸거나 서버에 ADMIN_KEY가 없습니다.");

  const body = await response.json();
  if (!response.ok) fail(`실패(${response.status}): ${body.reason ?? ""}`);
  return { removed: body.removed, total: body.total, entries: body.entries };
}

async function remove(gameId, nickname) {
  // 열쇠는 **한 번만** 얻는다. 게임마다 물어보면 `rm all`이 세 번 묻는 꼴이 된다.
  const key = await adminKey();
  if (!key) fail("열쇠가 없습니다. `.admin-key` 파일을 만들거나 ADMIN_KEY를 넣어 주세요.");

  // 같은 사람이 세 게임에 흩어져 있을 때 게임 이름을 세 번 치지 않게 한다.
  // 판을 통째로 지우는 게 아니라 **이름 하나**만 훑는 것이라 확인 절차는 두지 않는다.
  if (gameId === "all") {
    let hit = 0;
    for (const game of GAMES) {
      const { removed, total } = await removeOne(game, nickname, key);
      hit += removed;
      console.log(`${game.padEnd(8)} ${removed > 0 ? "지움" : "없음"}  (남은 ${total}줄)`);
    }
    console.log(hit > 0 ? `\n${nickname} — 모두 ${hit}줄 지웠습니다.` : `\n${nickname} — 어느 게임에도 없었습니다.`);
    return;
  }

  const { removed, total, entries } = await removeOne(gameId, nickname, key);
  console.log(removed > 0 ? `지웠습니다: ${nickname}` : `그런 이름이 없습니다: ${nickname}`);
  console.log(`${gameId} — 남은 ${total}줄`);
  printBoard(entries);
}

/** 이름만 갈아끼운다. 지우기와 달리 **되돌릴 수 있다** — 잘못 바꿨으면 다시 바꾸면 된다.
 *  그래서 욕설 닉네임에는 이쪽을 먼저 쓴다(기록도 등수도 남는다). */
async function rename(gameId, from, to) {
  const key = await adminKey();
  if (!key) fail("열쇠가 없습니다. `.admin-key` 파일을 만들거나 ADMIN_KEY를 넣어 주세요.");

  const query = `gameId=${encodeURIComponent(gameId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const response = await fetch(`${SERVER}/solo/entry?${query}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${key}` },
  });
  if (response.status === 404) fail("거부됐습니다 — 열쇠가 틀렸거나 서버에 ADMIN_KEY가 없습니다.");

  const body = await response.json();
  if (!response.ok) fail(`실패(${response.status}): ${body.reason ?? ""}`);
  console.log(`${from} → ${to}`);
  console.log(`${gameId} — 총 ${body.total}줄`);
  printBoard(body.entries);
}

const [command, gameId, first, second] = process.argv.slice(2);
if (command === "ls" && gameId) await list(gameId);
else if (command === "rm" && gameId && first) await remove(gameId, first);
else if (command === "mv" && gameId && first && second) await rename(gameId, first, second);
else fail(USAGE);
