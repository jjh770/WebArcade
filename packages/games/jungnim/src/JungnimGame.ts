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
const HUD_COLOR = "#e8eef2"; // HUD 텍스트 — 원 밖 어두운 영역 위라 밝게.
const GRAZE_COLOR = "#ff9f1c"; // 니어 미스 순간 — 주황.
const FIRE_COLOR = "#ffd166"; // 발사 순간 — 밝은 금색(커브 피버와 같은 신호색).
const INVERT_COLOR = "#c77dff"; // 조작 반전 피격 중.
const SLUGGISH_COLOR = "#4dd0e1"; // 조작 둔화 피격 중.

/** 니어 미스·발사 연출이 화면에 남는 시간(tick). 연출 전용 — 판정과 무관. */
const GRAZE_FLASH_TICKS = 24;
const FIRE_FLASH_TICKS = 30;

/** 고정 스텝 주파수. 디버프 지속시간(ms)을 tick으로 바꿀 때만 쓴다. */
const TICK_HZ = 60;

// 원형 경기장 색: 어두운 바깥 + 얇은 테두리 + 밝은 바닥.
const ARENA_OUTSIDE = "#15171d";
const ARENA_BORDER = "#457b9d";
const ARENA_FLOOR = "#f1faee";
const ARENA_BORDER_W = 3;

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

  // 「스릴 게이지」 — 아주 가까이 스친 화살 수. needed번이면 발사(0으로 리셋).
  private grazeCount = 0;
  private grazeFlash = 0; // 스침 연출 잔여 tick
  private fireFlash = 0; // 발사 연출 잔여 tick
  /** 러너가 가져갈 발사 신호. 로컬 연출(fireFlash)과 별개 — 이건 "남에게 전송" 신호다. */
  private pendingFire = false;
  // 남의 발사에 맞아 걸린 조작계 디버프 잔여 tick.
  private invertTicks = 0;
  private sluggishTicks = 0;

  init(seed: number): void {
    this.commonPool = new ArrowPool(jungnimConfig.poolSize);
    this.commonSpawner = new ArrowSpawner(new SeededRNG(seed), jungnimConfig);
    this.personalSeed = (seed ^ PERSONAL_SEED_SALT) >>> 0;
    this.me = this.newAvatar();
    this.centerAvatar(this.me);
    this.peers.clear();
    this.survivalTicks = 0;
    this.dead = false;
    this.grazeCount = 0;
    this.grazeFlash = 0;
    this.fireFlash = 0;
    this.pendingFire = false;
    this.invertTicks = 0;
    this.sluggishTicks = 0;
  }

  update(tick: number, input: InputState): void {
    // 살아있을 때만: 플레이어 이동 + 내 개인 스폰 + 피격 판정.
    if (!this.dead) {
      if (this.grazeFlash > 0) this.grazeFlash--;
      if (this.fireFlash > 0) this.fireFlash--;
      // 피격 디버프는 **내 입력·속도 사본**에만 건다. 공통 월드는 그대로라 남과 안 어긋난다.
      let left = input.left;
      let right = input.right;
      let up = input.up;
      let down = input.down;
      if (this.invertTicks > 0) {
        this.invertTicks--;
        [left, right] = [right, left]; // 4방향 게임이라 상하까지 전부 뒤집는다
        [up, down] = [down, up];
      }
      let s = jungnimConfig.playerSpeed;
      if (this.sluggishTicks > 0) {
        this.sluggishTicks--;
        s *= jungnimConfig.fire.sluggishSpeedMult;
      }
      if (left) this.me.x -= s;
      if (right) this.me.x += s;
      if (up) this.me.y -= s;
      if (down) this.me.y += s;
      clampToArena(this.me); // 사각형이 아니라 원 안으로 가둔다.
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
      else this.scanNearMiss(); // 맞아 죽은 화살은 스침으로 안 친다
      this.survivalTicks = tick; // 사망 프레임까지 포함 → 생존시간 = 사망 tick.
    }
  }

  /** 「스릴 게이지」: 아주 가까이 스치고 지나간 화살을 센다. 화살 하나당 딱 한 번
   *  (밴드 안에 여러 tick 머물러도 중복 없음 — Arrow.grazed 표식). needed번 모이면
   *  발사되고 0으로 리셋된다. 남의 개인 화살은 내 위험이 아니라 세지 않는다. */
  private scanNearMiss(): void {
    const radius = jungnimConfig.nearMiss.grazeRadius;
    const radius2 = radius * radius;
    const grazed = this.markGrazes(this.commonPool, radius2) + this.markGrazes(this.me.pool, radius2);
    if (grazed === 0) return;
    this.grazeCount += grazed;
    this.grazeFlash = GRAZE_FLASH_TICKS;
    if (this.grazeCount >= jungnimConfig.nearMiss.needed) {
      this.grazeCount = 0;
      this.fireFlash = FIRE_FLASH_TICKS; // 발사! — 연출 시작
      this.pendingFire = true; // 러너가 가져가 관전 중인 상대 1명에게 디버프를 쏜다(멀티).
    }
  }

  /** 아직 안 센 화살 중 스침 밴드 안에 들어온 것에 표식을 남기고 그 수를 돌려준다. */
  private markGrazes(pool: ArrowPool, radius2: number): number {
    let count = 0;
    for (const a of pool.items) {
      if (!a.active || a.grazed) continue;
      const dx = this.me.x - a.x;
      const dy = this.me.y - a.y;
      if (dx * dx + dy * dy > radius2) continue;
      a.grazed = true;
      count++;
    }
    return count;
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
    this.drawArena(r);
    this.drawPool(r, this.commonPool); // 공통 화살
    this.drawPool(r, this.me.pool); // 내 개인 화살

    // 스침·발사 손맛은 플레이어 옆에 위치성으로 남긴다(게이지 수치는 캔버스 밖 DOM HUD).
    if (!this.dead && this.fireFlash > 0) {
      this.drawFireBurst(r);
      r.text("발사!", this.me.x + 12, this.me.y - 28, FIRE_COLOR, 16);
    } else if (!this.dead && this.grazeFlash > 0) {
      r.text("니어 미스!", this.me.x + 12, this.me.y - 12, GRAZE_COLOR, 14);
    }
    // 조작계 디버프 피격 중: 플레이어를 디버프색으로 바꾸고 옆에 경고 문구를 띄운다
    // (화면 전체 배너는 앱이 따로 그린다 — 여기선 지속 표시로 남긴다).
    if (!this.dead && this.invertTicks > 0) {
      r.text("조작 반전!", this.me.x + 12, this.me.y + 24, INVERT_COLOR, 15);
      r.circle(this.me.x, this.me.y, jungnimConfig.playerRadius, INVERT_COLOR);
    } else if (!this.dead && this.sluggishTicks > 0) {
      r.text("조작 둔화!", this.me.x + 12, this.me.y + 24, SLUGGISH_COLOR, 15);
      r.circle(this.me.x, this.me.y, jungnimConfig.playerRadius, SLUGGISH_COLOR);
    } else {
      r.circle(this.me.x, this.me.y, jungnimConfig.playerRadius, PLAYER_COLOR);
    }

    // 생존 시간은 캔버스 밖 DOM HUD가 보여준다(getScore로 전달). 여기선 안 그린다.
    if (this.dead) {
      const cx = jungnimConfig.screenWidth / 2;
      const cy = jungnimConfig.screenHeight / 2;
      r.text(`사망 — 생존 ${(this.survivalTicks / 60).toFixed(1)}s`, cx - 90, cy, PLAYER_COLOR, 26);
    }
  }

  renderSpectator(r: IRenderer, target: SpectateTarget): void {
    this.drawArena(r);
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

  /** 「스릴 게이지」 값(0~1) — 스침 횟수 / 발사에 필요한 횟수. HUD·테스트용. */
  getGauge(): number {
    return this.grazeCount / jungnimConfig.nearMiss.needed;
  }

  /** 러너가 매 스텝 물어본다: 발사가 대기 중이면 걸 수 있는 **디버프 풀**을 돌려주고
   *  플래그를 내린다(한 번만 전송). 어느 디버프를 누구에게 보낼지는 앱이 정한다. */
  consumePendingFire(): readonly { kind: string; durationMs: number }[] | null {
    if (!this.pendingFire) return null;
    this.pendingFire = false;
    return jungnimConfig.fire.debuffs;
  }

  /** 남의 발사에 맞았다. 아는 조작계 디버프면 지속시간(ms)만큼 로컬에 건다 — invert(좌우
   *  반전)·sluggish(이동 둔화). 시각계(blur·shake·cloud)는 앱이 화면에 처리하므로 여기선
   *  무시한다(모르는 kind도 무시 → 효과가 늘어도 옛 클라가 안 죽는다). 이미 죽었으면 무시.
   *  결정론 안전: 내 입력·속도만 바꿀 뿐 공통 월드는 안 건드린다. */
  applyEffect(kind: string, durationMs: number): void {
    if (this.dead) return;
    const ticks = Math.round((durationMs / 1000) * TICK_HZ);
    if (kind === "invert") this.invertTicks = Math.max(this.invertTicks, ticks);
    else if (kind === "sluggish") this.sluggishTicks = Math.max(this.sluggishTicks, ticks);
  }

  // ---- 내부 ----

  /** 발사 순간: 플레이어에서 8방향으로 빛줄기가 퍼져나갔다 사그라든다.
   *  fireFlash가 줄수록 더 바깥으로 밀려나며 짧아져 "쏜" 느낌을 준다. */
  private drawFireBurst(r: IRenderer): void {
    const progress = 1 - this.fireFlash / FIRE_FLASH_TICKS; // 0(막 발사) → 1(끝)
    const start = jungnimConfig.playerRadius + 4 + progress * 34;
    const len = 18 * (1 - progress);
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 4) * i;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      r.line(
        this.me.x + cos * start,
        this.me.y + sin * start,
        this.me.x + cos * (start + len),
        this.me.y + sin * (start + len),
        FIRE_COLOR,
        3,
      );
    }
  }

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

  /** 원형 경기장: 어두운 배경을 깔고, 그 위에 테두리 원 → 밝은 바닥 원을 겹쳐 링을 만든다. */
  private drawArena(r: IRenderer): void {
    const { cx, cy, radius } = jungnimConfig.arena;
    r.clear();
    r.rect(0, 0, jungnimConfig.screenWidth, jungnimConfig.screenHeight, ARENA_OUTSIDE);
    r.circle(cx, cy, radius, ARENA_BORDER);
    r.circle(cx, cy, radius - ARENA_BORDER_W, ARENA_FLOOR);
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

  /** 활성 화살을 한 스텝 전진시키고, 경기장 원 밖으로 나간 것은 풀로 반납. */
  private moveArrows(pool: ArrowPool): void {
    const { cx, cy, radius } = jungnimConfig.arena;
    const cull = radius + jungnimConfig.arrowLength; // 둘레를 이만큼 벗어나면 사라진다.
    const cull2 = cull * cull;
    for (const a of pool.items) {
      if (!a.active) continue;
      a.x += a.vx;
      a.y += a.vy;
      const dx = a.x - cx;
      const dy = a.y - cy;
      if (dx * dx + dy * dy > cull2) pool.release(a);
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

/** 아바타를 원형 경기장 안으로 끌어당긴다. 중심에서 (반지름-플레이어반지름)보다 멀면
 *  그 경계 원 위로 되돌린다. 결정론과 무관하지만 부수효과는 아바타 좌표에 국한. */
function clampToArena(a: { x: number; y: number }): void {
  const { cx, cy, radius } = jungnimConfig.arena;
  const maxDist = radius - jungnimConfig.playerRadius;
  const dx = a.x - cx;
  const dy = a.y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > maxDist && dist > 0) {
    a.x = cx + (dx / dist) * maxDist;
    a.y = cy + (dy / dist) * maxDist;
  }
}
