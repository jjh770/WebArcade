/* ============================================================
   ItemSpawner — 방해 발사를 주는 아이템 (죽림고수)
   ------------------------------------------------------------
   경기장 어딘가에 아주 가끔 아이템이 뜨고, 닿으면 상대 한 명에게 방해 디버프를 쏜다.

   ⚠️ 불변식: "언제/어디에" 뜨는지는 **시드와 tick에서만** 나온다. 그래야 모두가
   같은 자리에 같은 아이템을 본다(플레이어 위치를 참조하면 클라마다 달라진다).
   화살 스포너들과 **별개 RNG 스트림**을 써야 한다 — 같은 스트림을 나눠 쓰면
   아이템 유무가 화살 패턴까지 밀어버린다.

   ⚠️ "누가 먹었나"는 반대로 **로컬 판정**이다. 내 위치는 나만 아니까.
   그래서 아이템은 각자 먹는다 — 남이 가져가도 내 것은 그대로 남는다.
   대신 스폰 일정(nextSpawnTick)은 내가 먹든 말든 바뀌지 않는다. 획득이 일정을
   흔들면 그때부터 클라마다 아이템 시각이 어긋난다.
   ============================================================ */

import type { SeededRNG } from "@arcade/core";
import type { JungnimConfig } from "./config";

/** 지금 떠 있는 아이템. 없으면 null. kind는 config.item.kinds의 슬러그. */
export type Item = { kind: string; x: number; y: number; bornTick: number; expireTick: number };

const TAU = Math.PI * 2;

export class ItemSpawner {
  private item: Item | null = null;
  /** 다음 아이템이 뜨는 tick. 획득과 무관하게 시드에서만 정해진다. */
  private nextSpawnTick: number;

  constructor(
    private readonly rng: SeededRNG,
    private readonly cfg: JungnimConfig,
  ) {
    this.nextSpawnTick = cfg.item.unlockTick;
  }

  /** 지금 화면에 떠 있는 아이템(렌더·획득 판정용). */
  get current(): Item | null {
    return this.item;
  }

  /** 매 고정 스텝 호출. 수명이 다한 아이템을 치우고, 시각이 되면 새로 띄운다. */
  update(tick: number): void {
    if (this.item && tick >= this.item.expireTick) this.item = null;
    if (tick < this.nextSpawnTick) return;

    this.item = this.roll(tick);
    const { intervalTicks, intervalJitterTicks } = this.cfg.item;
    // 다음 시각을 먼저 확정한다 — 이 값은 획득 여부를 절대 보지 않는다.
    this.nextSpawnTick = tick + intervalTicks + Math.floor(this.rng.next() * intervalJitterTicks);
  }

  /** 아이템을 가져간다(로컬). 같은 아이템을 두 번 먹지 못하게 즉시 치운다. */
  consume(): void {
    this.item = null;
  }

  /** 라운드 리셋. init에서 RNG를 새로 만들 때 함께 호출한다. */
  reset(): void {
    this.item = null;
    this.nextSpawnTick = this.cfg.item.unlockTick;
  }

  /** 경기장 안 임의의 자리. 벽에 붙어 뜨면 화살을 뚫고 가야 해서 안쪽으로 여백을 둔다.
   *  균일 분포를 위해 반지름에 sqrt를 씌운다(안 씌우면 중심에 몰린다). */
  private roll(tick: number): Item {
    const { cx, cy, radius } = this.cfg.arena;
    const { edgeMargin, lifetimeTicks } = this.cfg.item;
    const maxDist = Math.max(0, radius - edgeMargin);
    const kind = this.pickKind();
    const angle = this.rng.next() * TAU;
    const dist = Math.sqrt(this.rng.next()) * maxDist;
    return {
      kind,
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist,
      bornTick: tick,
      expireTick: tick + lifetimeTicks,
    };
  }

  /** 가중치대로 종류 하나를 뽑는다(누적합 방식). 시드에서 나오므로 모두가 같은 종류를 본다. */
  private pickKind(): string {
    const kinds = this.cfg.item.kinds;
    const total = kinds.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = this.rng.next() * total;
    for (const entry of kinds) {
      roll -= entry.weight;
      if (roll < 0) return entry.kind;
    }
    return kinds[kinds.length - 1]!.kind; // 부동소수 오차로 끝까지 갔을 때
  }
}
