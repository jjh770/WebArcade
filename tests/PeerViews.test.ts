/* 곁창(우측 실시간 관전창)을 켜고 끄는 규칙.

   2026-08-18 사용자 결정으로 이건 **각자의 설정**이지 방의 규칙이 아니다. 그래서 서버도
   판정도 이 값을 모르고, 여기서 지킬 것은 두 가지뿐이다.
   1) 끄면 곁창이 하나도 안 뜬다 — 그래야 그 폭이 판으로 간다.
   2) **죽은 뒤 남의 화면으로 넘어가는 것은 그대로다.** 저건 곁창이 아니라 내 판 자리에서
      일어나는 일이라, 곁창을 껐다고 같이 꺼지면 안 된다. */
import { describe, expect, it } from "vitest";
import type { PlayerPublic } from "@arcade/shared";
import { PeerViews } from "../packages/app/src/peerViews";

const SLOTS = 3;
const W = 800;

/** 관전창 표시 요청을 그대로 받아 적는 가짜 화면. */
function harness() {
  const shown: { index: number; visible: boolean; label: string }[] = [];
  const views = new PeerViews({
    slots: SLOTS,
    logicalWidth: W,
    logicalHeight: W,
    onSideSlot: (index, visible, label) => shown.push({ index, visible, label }),
  });
  /** 마지막으로 보고된 슬롯 상태(같은 슬롯이 여러 번 보고되므로 뒤엣것이 이긴다). */
  const slotState = () => {
    const last = new Map<number, boolean>();
    for (const call of shown) last.set(call.index, call.visible);
    return [...Array(SLOTS).keys()].map((i) => last.get(i) ?? false);
  };
  return { views, shown, slotState, reset: () => (shown.length = 0) };
}

const roster = (n: number): PlayerPublic[] =>
  [...Array(n).keys()].map((i) => ({ id: `p${i}`, nickname: `p${i}`, alive: true, score: 0 }));

/** 렌더러 자리는 안 본다 — 이 테스트가 보는 건 슬롯 표시와 메인 대상뿐이다. */
const fake = () => ({}) as never;

function seat(views: PeerViews, others: number) {
  views.setRoster(roster(others + 1), "p0");
  views.reset();
  // 남들이 살아 있다고 알린다(스냅샷 한 번이면 충분하다).
  views.applySnapshot(
    roster(others + 1).filter((p) => p.id !== "p0").map((p) => ({ id: p.id, a: 100, b: 100 })),
    () => {},
  );
}

describe("곁창 켜고 끄기", () => {
  it("켜면 살아 있는 남들이 슬롯에 뜬다", () => {
    const h = harness();
    seat(h.views, 3);
    h.reset();
    h.views.buildViews(fake(), [fake(), fake(), fake()]);
    expect(h.slotState()).toEqual([true, true, true]);
  });

  it("끄면 슬롯이 하나도 안 뜬다 — 그래야 그 폭이 판으로 간다", () => {
    const h = harness();
    seat(h.views, 3);
    h.views.setSideViews(false);
    h.reset();
    h.views.buildViews(fake(), [fake(), fake(), fake()]);
    expect(h.slotState()).toEqual([false, false, false]);
    // 슬롯을 "안 건드리는" 게 아니라 **내려 달라고 보고**해야 한다. 안 그러면 앞 라운드의
    // 곁창이 남고, 칼럼도 안 걷힌다.
    expect(h.shown.length).toBe(SLOTS);
  });

  it("껐다 켜면 다시 뜬다", () => {
    const h = harness();
    seat(h.views, 3);
    h.views.setSideViews(false);
    h.views.buildViews(fake(), [fake(), fake(), fake()]);
    h.views.setSideViews(true);
    h.reset();
    h.views.buildViews(fake(), [fake(), fake(), fake()]);
    expect(h.slotState()).toEqual([true, true, true]);
  });

  it("꺼도 죽으면 남의 화면으로 넘어가고 ←→로 순환한다", () => {
    const h = harness();
    seat(h.views, 3);
    h.views.setSideViews(false);

    expect(h.views.watchRandom()).toBe(true); // 볼 사람이 있다
    const main = () => {
      h.reset();
      const views = h.views.buildViews(fake(), [fake(), fake(), fake()]);
      return views[0]!.target?.id ?? null;
    };
    const first = main();
    expect(first).not.toBeNull(); // 메인이 남의 화면이 됐다
    expect(h.slotState()).toEqual([false, false, false]); // 그래도 곁창은 없다

    expect(h.views.cycle(1)).toBe(true);
    expect(main()).not.toBe(first); // 다른 사람으로 넘어갔다
  });
});
