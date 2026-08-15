import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* 설치용 아이콘과 색은 **네 파일에 흩어져 있다** — base.css(토큰) · manifest(설치한 창의 띠) ·
   make-icons.mjs(PNG를 굽는 값) · favicon.svg(탭 아이콘). 코드가 서로를 못 읽는 자리라
   손으로 맞추는 수밖에 없는데, 어긋나도 **화면에서는 안 보인다.** 홈 화면에 추가해서
   열어 봐야 위아래 띠만 딴 색인 걸 알게 된다. 그래서 여기서 못 박는다.
   (구조를 붙드는 테스트가 아니라 "설치한 앱이 사이트와 같은 얼굴"이라는 약속을 지킨다.) */

const ROOT = join(__dirname, "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

const BG = "#0d1017"; // base.css의 --bg
const PRIMARY = "#5eebff"; // --primary
const DANGER = "#ff4d67"; // --danger

describe("설치용 아이콘과 색", () => {
  it("바탕색은 base.css의 --bg 하나에서 나온다", () => {
    expect(read("packages/app/src/styles/base.css")).toContain(`--bg: ${BG}`);
    const manifest = JSON.parse(read("packages/app/public/manifest.webmanifest"));
    expect(manifest.theme_color).toBe(BG);
    expect(manifest.background_color).toBe(BG);
    expect(read("packages/app/index.html")).toContain(`name="theme-color" content="${BG}"`);
  });

  it("과녁 색 셋이 PNG를 굽는 스크립트와 SVG에서 같다", () => {
    const script = read("scripts/make-icons.mjs");
    const svg = read("packages/app/public/favicon.svg");
    for (const [name, hex] of [["bg", BG], ["primary", PRIMARY], ["danger", DANGER]] as const) {
      // 스크립트는 바이트 배열로 적는다(0x0d, 0x10, ...) — 같은 값인지 그렇게 확인한다.
      const bytes = hex.slice(1).match(/../g)!.map((pair) => `0x${pair}`).join(", ");
      expect(script, `make-icons.mjs의 ${name}`).toContain(bytes);
      expect(svg.toLowerCase(), `favicon.svg의 ${name}`).toContain(hex);
    }
  });

  it("manifest가 선언한 아이콘이 실제로 있고 마스크형이 한 장 있다", () => {
    const manifest = JSON.parse(read("packages/app/public/manifest.webmanifest"));
    for (const icon of manifest.icons) {
      const bytes = readFileSync(join(ROOT, "packages/app/public", icon.src));
      // PNG 머리 8바이트 + IHDR의 가로·세로. 선언한 크기와 다르면 안드로이드가 아이콘을 버린다.
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const declared = Number(icon.sizes.split("x")[0]);
      expect(bytes.readUInt32BE(16), `${icon.src}의 가로`).toBe(declared);
      expect(bytes.readUInt32BE(20), `${icon.src}의 세로`).toBe(declared);
    }
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
  });

  it("설치에 필요한 항목이 manifest에 다 있다", () => {
    const manifest = JSON.parse(read("packages/app/public/manifest.webmanifest"));
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    // 192와 512는 안드로이드가 각각 홈 화면과 시작 화면에 쓴다. 둘 다 있어야 한다.
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });
});
