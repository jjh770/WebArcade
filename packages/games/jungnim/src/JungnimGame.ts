/* ============================================================
   JungnimGame — 죽림고수. IGame 구현.
   ------------------------------------------------------------
   이 클래스는 games/ 안에만 존재한다. core는 이걸 모른다.
   core의 GameRunner는 IGame 인터페이스로만 이 게임을 구동한다.

   진행 상황(DESIGN.md 7절): 싱글·멀티·관전 기반이 구현된 첫 게임. IGame만
   구현하며 core는 이 클래스를 모른다. 실제 멀티 수용 검증 뒤 두 번째 게임이 IGame 추상을 확정한다.

   화살 구조(두 레이어 + 아바타):
   - 공통(common): 시드 기반, 모두가 동일. commonPool 하나. (관전자도 그대로 봄)
   - 개인(personal): "그 사람을 조준". 아바타(나 + 관전 대상 남들)마다 별도 풀.
     개인 스포너는 공유 personalSeed를 쓰므로 스폰 스케줄·패턴은 모두 같고,
     조준/출발점만 그 아바타의 위치에 의존한다 → 남의 위치만 알면 그 사람의
     개인 화살을 관전 화면에서 시각적으로 근사할 수 있다. (DESIGN 관전 가시성)
   ============================================================ */

import type { IGame, IRenderer, InputState, SpectateTarget, PeerState } from "@arcade/shared";
import { SeededRNG } from "@arcade/core";
import { jungnimConfig } from "./config";
import { ArrowSpawner } from "./ArrowSpawner";
import { PersonalSpawner } from "./PersonalSpawner";
import { ArrowPool } from "./ArrowPool";

const PLAYER_COLOR = "#e63946";
const ARROW_COLOR = "#1d3557"; // 공통(시드) 화살 — 짙은 남색.
const PERSONAL_COLOR = "#f77f00"; // 개인(조준) 화살 — 주황. "너를 노린다"는 신호.
const HUD_COLOR = "#1d3557";

/** 개인 시드 = 공통 시드에서 파생(별도 스트림 보장). 값 자체는 임의의 큰 홀수 상수.
 *  ⚠️ 현재는 모든 플레이어가 같은 personalSeed → 개인 스폰 스케줄·패턴이 동일하고
 *  조준만 위치로 갈린다. 관전자는 원격 위치를 보간해 개인 화살을 근사한다.
 *  멀티에서 플레이어별로 다르게 하려면 playerId를 섞고, 관전 계산에도 그 id가 필요하다. */
const PERSONAL_SEED_SALT = 0x9e3779b9;

/** 개인 화살을 계산할 대상(나 또는 관전 대상 남).
 *  x,y = 실제 사용(렌더·스폰) 위치. tx,ty = 네트워크로 받은 목표 위치.
 *  관전 대상은 매 틱 x,y를 tx,ty로 부드럽게 당겨(ease) 끊김 없이 움직인다. */
type Avatar = { x: number; y: number; tx: number; ty: number; pool: ArrowPool; spawner: PersonalSpawner };

export class JungnimGame implements IGame {
  // 공통(시드) 레이어 — 모두 동일.
  private commonPool!: ArrowPool;
  private commonSpawner!: ArrowSpawner;
  // 개인 아바타: 나 + 관전 대상 남들. 전부 공유 personalSeed로 스포너를 만든다.
  private personalSeed = 0;
  private me!: Avatar;
  private readonly peers = new Map<string, Avatar>();

  private survivalTicks = 0;
  private dead = false;

  init(seed: number): void {
    this.commonPool = new ArrowPool(jungnimConfig.poolSize);
    this.commonSpawner = new ArrowSpawner(new SeededRNG(seed), jungnimConfig);
    this.personalSeed = (seed ^ PERSONAL_SEED_SALT) >>> 0;
    this.me = this.newAvatar();
    this.centerAvatar(this.me);
    this.peers.clear();
    this.survivalTicks = 0;
    this.dead = false;
  }

  update(tick: number, input: InputState): void {
    // 살아있을 때만: 플레이어 이동 + 내 개인 스폰 + 피격 판정.
    if (!this.dead) {
      const s = jungnimConfig.playerSpeed;
      if (input.left) this.me.x -= s;
      if (input.right) this.me.x += s;
      if (input.up) this.me.y -= s;
      if (input.down) this.me.y += s;
      const r = jungnimConfig.playerRadius;
      this.me.x = clamp(this.me.x, r, jungnimConfig.screenWidth - r);
      this.me.y = clamp(this.me.y, r, jungnimConfig.screenHeight - r);
      this.me.spawner.update(tick, this.me.pool, this.me.x, this.me.y);
    }
    this.moveArrows(this.me.pool);

    // ⚠️ 공통 월드는 사망과 무관하게 항상 전진(남들과 안 어긋나게 + 관전 배경).
    this.commonSpawner.update(tick, this.commonPool);
    this.moveArrows(this.commonPool);

    // 관전 대상(남)들: 네트워크 위치(tx,ty)로 부드럽게 당긴 뒤 개인 화살을 근사.
    // 위치가 ~10Hz라 매 틱 ease해야 점·화살이 끊기지 않는다.
    const s = jungnimConfig.spectateSmoothing;
    for (const peer of this.peers.values()) {
      peer.x += (peer.tx - peer.x) * s;
      peer.y += (peer.ty - peer.y) * s;
      peer.spawner.update(tick, peer.pool, peer.x, peer.y);
      this.moveArrows(peer.pool);
    }

    if (!this.dead) {
      if (this.checkHit()) this.dead = true;
      this.survivalTicks = tick; // 사망 프레임까지 포함 → 생존시간 = 사망 tick.
    }
  }

  /** 관전 대상(남)들의 목표 위치를 반영. 새 대상은 아바타 생성, 빠진 대상은 제거. */
  syncPeers(peers: readonly PeerState[]): void {
    const seen = new Set<string>();
    for (const p of peers) {
      seen.add(p.id);
      const existing = this.peers.get(p.id);
      if (existing) {
        existing.tx = p.x; // 목표만 갱신 — 실제 위치(x,y)는 update에서 부드럽게 당김.
        existing.ty = p.y;
      } else {
        // 새 대상: 첫 위치엔 스냅(0에서 튀지 않게), 이후부터 ease.
        const a = this.newAvatar();
        a.x = a.tx = p.x;
        a.y = a.ty = p.y;
        this.peers.set(p.id, a);
      }
    }
    for (const id of [...this.peers.keys()]) if (!seen.has(id)) this.peers.delete(id);
  }

  render(r: IRenderer, _alpha: number): void {
    r.clear();
    this.drawPool(r, this.commonPool); // 공통 화살
    this.drawPool(r, this.me.pool); // 내 개인 화살
    r.circle(this.me.x, this.me.y, jungnimConfig.playerRadius, PLAYER_COLOR);

    r.text(`${(this.survivalTicks / 60).toFixed(1)}s`, 12, 28, HUD_COLOR, 22);
    if (this.dead) {
      const cx = jungnimConfig.screenWidth / 2;
      const cy = jungnimConfig.screenHeight / 2;
      r.text(`사망 — 생존 ${(this.survivalTicks / 60).toFixed(1)}s`, cx - 90, cy, PLAYER_COLOR, 26);
    }
  }

  renderSpectator(r: IRenderer, target: SpectateTarget): void {
    r.clear();
    this.drawPool(r, this.commonPool); // 공통 화살(모두 동일)
    const peer = this.peers.get(target.id);
    // 점·화살 모두 ease된 위치(peer.x,y)로 그려 부드럽게. 없으면 target 좌표 폴백.
    const dotX = peer ? peer.x : target.x;
    const dotY = peer ? peer.y : target.y;
    if (peer) this.drawPool(r, peer.pool); // 그 사람의 개인(조준) 화살 시각 근사
    r.circle(dotX, dotY, jungnimConfig.playerRadius, PLAYER_COLOR);
    r.text(`관전: ${target.label}`, 12, 28, HUD_COLOR, 22);
  }

  isPlayerDead(): boolean {
    return this.dead;
  }

  getPosition(): { x: number; y: number } {
    return { x: this.me.x, y: this.me.y };
  }

  getScore(): number {
    return this.survivalTicks;
  }

  // ---- 내부 ----

  private newAvatar(): Avatar {
    return {
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      pool: new ArrowPool(jungnimConfig.poolSize),
      spawner: new PersonalSpawner(new SeededRNG(this.personalSeed), jungnimConfig),
    };
  }

  private centerAvatar(a: Avatar): void {
    a.x = jungnimConfig.screenWidth / 2;
    a.y = jungnimConfig.screenHeight / 2;
  }

  private drawPool(r: IRenderer, pool: ArrowPool): void {
    for (const a of pool.items) if (a.active) this.drawArrow(r, a);
  }

  /** 화살 하나를 진행 방향(대각선 포함) 짧은 선으로 그린다. 색은 공통/개인 구분. */
  private drawArrow(r: IRenderer, a: { x: number; y: number; vx: number; vy: number; personal: boolean }): void {
    const half = jungnimConfig.arrowLength / 2;
    const len = Math.hypot(a.vx, a.vy) || 1;
    const ux = (a.vx / len) * half;
    const uy = (a.vy / len) * half;
    r.line(a.x - ux, a.y - uy, a.x + ux, a.y + uy, a.personal ? PERSONAL_COLOR : ARROW_COLOR, 3);
  }

  /** 활성 화살을 한 스텝 전진시키고, 화면 밖으로 나간 것은 풀로 반납. */
  private moveArrows(pool: ArrowPool): void {
    const margin = jungnimConfig.arrowLength;
    const w = jungnimConfig.screenWidth;
    const h = jungnimConfig.screenHeight;
    for (const a of pool.items) {
      if (!a.active) continue;
      a.x += a.vx;
      a.y += a.vy;
      if (a.x < -margin || a.x > w + margin || a.y < -margin || a.y > h + margin) {
        pool.release(a);
      }
    }
  }

  /** 내 플레이어와 화살(공통 + 내 개인)의 원-원 충돌. 남의 개인 화살은 판정 대상 아님. */
  private checkHit(): boolean {
    const hitR = jungnimConfig.playerRadius + jungnimConfig.arrowRadius;
    const hitR2 = hitR * hitR;
    return this.hitInPool(this.commonPool, hitR2) || this.hitInPool(this.me.pool, hitR2);
  }

  private hitInPool(pool: ArrowPool, hitR2: number): boolean {
    for (const a of pool.items) {
      if (!a.active) continue;
      const dx = this.me.x - a.x;
      const dy = this.me.y - a.y;
      if (dx * dx + dy * dy <= hitR2) return true;
    }
    return false;
  }
}

/** 값을 [min, max]로 제한. 순수 함수(결정론과 무관하지만 부수효과 없음 선호). */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
