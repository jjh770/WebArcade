/* ============================================================
   encode-bgm — 배경음악 ogg에 m4a 짝을 만들어 준다
   ------------------------------------------------------------
   왜 있나: **iOS Safari는 Ogg Vorbis를 못 읽는다.** 아이폰에서만 음악이 통째로
   조용했다(bgm.ts는 실패를 무음으로 삼키므로 오류도 안 났다). 그래서 같은 곡을
   AAC(.m4a)로 한 벌 더 두고, 브라우저에게 물어 되는 쪽을 튼다(bgm.ts의 pickExtension).

     node scripts/encode-bgm.mjs          # 없거나 낡은 것만
     node scripts/encode-bgm.mjs --force  # 전부 다시

   ⚠️ **ffmpeg가 PATH에 있어야 한다**(`winget install Gyan.FFmpeg`). 저장소에
      devDependency로 넣지 않은 이유: 곡 추가는 드문 일인데 80MB짜리 바이너리를
      clean install마다(CI 포함) 내려받게 된다.

   비트레이트는 원본에서 정한다 — 22kbps 모노를 128k로 부풀리면 용량만 늘고 소리는
   그대로다. 반대로 298kbps짜리를 그대로 두면 폰에서 받느라 늘어진다. 그래서
   **원본 값을 64~160k 사이로 자른다.** 채널 수(모노/스테레오)는 건드리지 않는다.

   ⚠️ `+faststart`를 반드시 준다. 이게 없으면 재생에 필요한 색인(moov)이 파일 **끝**에
      있어서, 스트리밍으로 읽는 `<audio>`가 첫 소리를 내기 전에 파일을 거의 다 받는다.
   ============================================================ */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("../packages/app/public/bgm/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const FORCE = process.argv.includes("--force");
/** 원본이 이 범위 밖이면 잘라 쓴다(kbps). 아래쪽을 48까지 열어 둔 이유: 원본에
 *  48~64kbps짜리가 실제로 있고, 거기에 64k를 강요하면 **소리는 그대로인데 파일만
 *  커진다**(첫 시도에서 다섯 곡 중 넷이 그렇게 불어났다). */
const MIN_KBPS = 48;
const MAX_KBPS = 160;

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function requireFfmpeg() {
  try {
    run("ffmpeg", ["-version"]);
  } catch {
    console.error("ffmpeg를 찾지 못했습니다. `winget install Gyan.FFmpeg` 뒤 새 터미널에서 다시 실행해 주세요.");
    process.exit(1);
  }
}

/** 원본이 **실제로 쓴** 비트레이트(kbps).
 *  ⚠️ 컨테이너(format) 값을 본다. ogg는 VBR이라 스트림에 적힌 값은 이름표에 가깝고,
 *     실제 평균보다 높다(midnight_drive: 스트림 160k / 실제 138k). 스트림 값을 믿고
 *     인코딩하면 원본보다 큰 파일이 나온다 — 실제로 그렇게 됐었다. */
function sourceKbps(file) {
  // ⚠️ 두 번 나눠 묻는다. 한 번에 물으면 ffprobe가 **인자 순서와 무관하게** 스트림을
  //    먼저 찍어서, 앞에서 고르든 뒤에서 고르든 원하는 쪽을 집는다는 보장이 없다.
  const kbps = probe(file, "format=bit_rate") ?? probe(file, "stream=bit_rate") ?? MIN_KBPS;
  return Math.min(MAX_KBPS, Math.max(MIN_KBPS, kbps));
}

/** ffprobe가 준 첫 숫자를 kbps로. 값이 없으면(N/A) null. */
function probe(file, entries) {
  const out = run("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "default=nw=1:nk=1", file]);
  const found = out.split(/\s+/).map(Number).find((n) => Number.isFinite(n) && n > 0);
  return found ? Math.round(found / 1000) : null;
}

function kb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

requireFfmpeg();

const songs = readdirSync(DIR).filter((f) => f.endsWith(".ogg"));
if (songs.length === 0) {
  console.error(`${DIR}에 .ogg가 없습니다.`);
  process.exit(1);
}

for (const song of songs) {
  const source = join(DIR, song);
  const target = source.replace(/\.ogg$/, ".m4a");
  let skip = false;
  try {
    skip = !FORCE && statSync(target).mtimeMs >= statSync(source).mtimeMs;
  } catch {
    // 짝이 아직 없다 — 만든다.
  }
  if (skip) {
    console.log(`${song.padEnd(28)} 그대로 (이미 최신)`);
    continue;
  }

  const kbps = sourceKbps(source);
  run("ffmpeg", [
    "-y",
    "-i", source,
    "-vn", // 앨범아트가 박혀 있으면 m4a에 영상 트랙으로 들어간다
    "-c:a", "aac",
    "-b:a", `${kbps}k`,
    "-movflags", "+faststart",
    target,
  ]);
  console.log(
    `${song.padEnd(28)} ${kb(statSync(source).size)} → ${kb(statSync(target).size)}  (aac ${kbps}k)`,
  );
}
