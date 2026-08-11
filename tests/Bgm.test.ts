/* ============================================================
   Bgm — 아이폰에서도 음악이 나는가
   ------------------------------------------------------------
   bgm.ts는 실패를 전부 조용한 무음으로 삼킨다. 그 관대함 때문에 "iOS에서 음악이
   안 난다"가 오래 안 잡혔다 — 오류도 로그도 없었다. 그래서 조용히 틀리는 두 가지를
   여기서 붙든다: 브라우저별 확장자 선택과, 두 벌 중 한 벌이 빠지는 것.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { TRACKS, chooseExtension } from "../packages/app/src/bgm";

const BGM_DIR = new URL("../packages/app/public/bgm/", import.meta.url);

/** 실제 canPlayType의 답 그대로 흉내 낸다 — "" | "maybe" | "probably". */
const chrome = (type: string): string => (type.startsWith("audio/ogg") ? "probably" : "maybe");
const ios = (type: string): string => (type.startsWith("audio/ogg") ? "" : "maybe");
const nothing = (): string => "";

describe("배경음악 파일 고르기", () => {
  it("ogg를 읽는 브라우저는 ogg를 고른다 — 같은 곡이 더 작다", () => {
    expect(chooseExtension(chrome)).toBe("ogg");
  });

  it("ogg에 빈 답을 주는 브라우저(iOS Safari)는 m4a로 넘어간다", () => {
    expect(chooseExtension(ios)).toBe("m4a");
  });

  it("둘 다 못 읽어도 던지지 않는다 — 조용한 무음이 이 파일의 방침이다", () => {
    expect(chooseExtension(nothing)).toBe("m4a");
  });
});

describe("등록된 곡은 두 벌 다 있다", () => {
  // 곡을 추가하고 encode-bgm을 안 돌리면 그 게임에서만 아이폰이 조용해진다.
  // 브라우저를 켜야만 드러나는 종류라 여기서 파일 존재로 확인한다.
  for (const [id, file] of Object.entries(TRACKS)) {
    it(`${id}: .ogg와 .m4a가 모두 있다`, () => {
      const missing = ["ogg", "m4a"].filter((ext) => !existsSync(new URL(`${file}.${ext}`, BGM_DIR)));
      expect(missing).toEqual([]);
    });
  }
});
