/* ============================================================
   make-icons — 앱 아이콘(PNG)을 그려서 굽는다
   ------------------------------------------------------------
   `node scripts/make-icons.mjs`

   그림 파일을 저장소에 손으로 넣어 두지 않고 **여기서 만든다.** 색이 바뀌면 아이콘도
   같이 바뀌어야 하는데, 손으로 만든 PNG는 바탕색 토큰이 바뀐 걸 알 방법이 없다.

   ⚠️ 의존성이 없다. 캔버스도 이미지 라이브러리도 안 쓰고 픽셀을 직접 채운 뒤
      zlib(내장)로 PNG를 인코딩한다 — 아이콘이 동심원 몇 개라 그 정도면 충분하다.
   ⚠️ 계단을 없애려고 4배로 그린 뒤 줄인다(supersampling). 원의 가장자리라 이게 없으면
      작은 크기에서 톱니가 그대로 보인다.
   ============================================================ */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "app", "public");

/* 색은 base.css의 토큰과 같은 값이다. 바뀌면 여기도 바꾼다 — 아이콘은 사이트의 얼굴이라
   혼자 다른 색을 쓰면 설치한 뒤 열었을 때 다른 앱처럼 보인다. */
const BG = [0x0d, 0x10, 0x17, 0xff]; // --bg
const RING = [0x5e, 0xeb, 0xff, 0xff]; // --primary
const CENTER = [0xff, 0x4d, 0x67, 0xff]; // --danger

/** 과녁 고리: 바깥부터 [반지름 비율, 색]. 비율은 아이콘 한 변 기준이다. */
const RINGS = [
  [0.46, RING],
  [0.35, BG],
  [0.24, RING],
  [0.12, BG],
  [0.06, CENTER],
];

const SS = 4; // supersampling 배수

/** 아이콘 한 장의 RGBA 픽셀을 만든다.
 *  @param size 최종 한 변(px)
 *  @param inset 그림을 안쪽으로 얼마나 들일지(0~1). 마스크형 아이콘은 모서리가 잘려서
 *               안전 영역(가운데 80%) 안에 들어와야 한다. */
function drawIcon(size, inset) {
  const big = size * SS;
  const pixels = new Uint8Array(big * big * 4);
  const center = big / 2;
  const scale = big * (1 - inset);
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const distance = Math.sqrt(dx * dx + dy * dy) / scale;
      let color = BG;
      for (const [radius, ringColor] of RINGS) {
        if (distance <= radius) color = ringColor;
      }
      const at = (y * big + x) * 4;
      pixels[at] = color[0];
      pixels[at + 1] = color[1];
      pixels[at + 2] = color[2];
      pixels[at + 3] = color[3];
    }
  }
  return downsample(pixels, big, size);
}

/** SS배로 그린 그림을 상자 평균으로 줄인다. */
function downsample(source, sourceSize, size) {
  const out = new Uint8Array(size * size * 4);
  const area = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const at = ((y * SS + sy) * sourceSize + (x * SS + sx)) * 4;
          r += source[at]; g += source[at + 1]; b += source[at + 2]; a += source[at + 3];
        }
      }
      const to = (y * size + x) * 4;
      out[to] = Math.round(r / area);
      out[to + 1] = Math.round(g / area);
      out[to + 2] = Math.round(b / area);
      out[to + 3] = Math.round(a / area);
    }
  }
  return out;
}

/* ---- PNG 인코딩 -------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  // 10~12: 압축·필터·인터레이스 방식은 각각 0 하나뿐이다.

  // 각 줄 앞에 필터 바이트(0 = 없음)를 붙인다. 동심원이라 예측 필터를 써도 별 이득이 없다.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---- 굽기 -------------------------------------------------------------- */

/** inset 0.06: 보통 아이콘은 가장자리에 약간의 여백만.
 *  inset 0.30: 마스크형은 원·둥근사각 어느 모양으로 잘려도 그림이 안 잘리게 더 들인다. */
const TARGETS = [
  ["icon-192.png", 192, 0.06],
  ["icon-512.png", 512, 0.06],
  ["icon-maskable-512.png", 512, 0.3],
  ["apple-touch-icon.png", 180, 0.06],
  ["icon-32.png", 32, 0.04],
];

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size, inset] of TARGETS) {
  const png = encodePng(drawIcon(size, inset), size);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)}KB`);
}
