/* 결정론 불변식 감시 (AGENTS.md 1-1) — packages/games·core의 .ts 편집 후 자동 실행.
   Math.random()·Date.now()가 들어오면 타입 에러도 테스트 실패도 없이 통과하지만,
   멀티에서 클라마다 월드가 갈라진다. 그 조용한 실패만 잡는다.
   ⚠️ 주석은 지운 뒤 검사한다 — 이 저장소는 "Math.random 없음" 같은 문구를 주석으로 남기고,
   배너 주석은 줄머리에 *가 없어서 줄 단위 필터로는 걸러지지 않는다.
   통과하면 아무것도 출력하지 않는다(토큰 0). 위반 시에만 줄 번호를 stderr로 낸다. */
import { readFileSync } from "node:fs";

const BANNED = /(Math\.random|Date\.now)\s*\(/;

let file = "";
try {
  file = (JSON.parse(readFileSync(0, "utf8") || "{}").tool_input?.file_path ?? "").replace(/\\/g, "/");
} catch {
  process.exit(0); // 훅 입력이 예상과 다르면 조용히 넘어간다 — 감시가 작업을 막아선 안 된다.
}
if (!/\/packages\/(games|core)\//.test(file) || !file.endsWith(".ts")) process.exit(0);

let source = "";
try {
  source = readFileSync(file, "utf8");
} catch {
  process.exit(0); // 지워졌거나 못 읽는 파일.
}

// 주석 자리를 공백으로 덮어 줄 번호는 그대로 유지한다.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, "");

const hits = code
  .split("\n")
  .map((line, index) => (BANNED.test(line) ? `${file}:${index + 1}: ${line.trim()}` : ""))
  .filter(Boolean);

if (hits.length === 0) process.exit(0);
console.error(`결정론 위반 (AGENTS.md 1-1) — SeededRNG와 tick에서만 파생할 것:\n${hits.join("\n")}`);
process.exit(2);
