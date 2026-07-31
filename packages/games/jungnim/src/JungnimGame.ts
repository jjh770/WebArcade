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
import { TICKS_PER_SECOND, formatTicks } from "@arcade/shared";
import { SeededRNG } from "@arcade/core";
import { jungnimConfig } from "./config";
import { ArrowSpawner } from "./ArrowSpawner";
import { PersonalSpawner } from "./PersonalSpawner";
import { ArrowPool, type Arrow } from "./ArrowPool";
import { ItemSpawner } from "./ItemSpawner";

const PLAYER_COLOR = "#e63946";
const ARROW_COLOR = "#1d3557"; // 공통(시드) 화살 — 짙은 남색.
const PERSONAL_COLOR = "#f77f00"; // 개인(조준) 화살 — 주황. "너를 노린다"는 신호.
const HUD_COLOR = "#e8eef2"; // HUD 텍스트 — 원 밖 어두운 영역 위라 밝게.
const ITEM_COLOR = "#ffd166"; // 아이템 기본색(모르는 종류). 종류별 색은 config.item.kinds.
const INVERT_COLOR = "#c77dff"; // 조작 반전 피격 중.
const SLUGGISH_COLOR = "#4dd0e1"; // 조작 둔화 피격 중.

/** 아이템이 커졌다 작아지는 맥동 주기(tick)와 진폭(배율). 순수 렌더. */
const ITEM_PULSE_TICKS = 40;
const ITEM_PULSE_AMOUNT = 0.18;
/** 사라지기 직전 이 tick 동안 깜빡여 "곧 없어진다"를 알린다. */
const ITEM_FADE_TICKS = 120;
/** 등장 순간 이 tick 동안 부풀어 오른다 — 탄막 속에서 "새로 생겼다"가 보이게. */
const ITEM_POP_TICKS = 15;
/** 획득 순간 아이템 자리에서 튀는 불꽃이 남는 시간(tick)과 개수. */
const PICKUP_FLASH_TICKS = 20;
const PICKUP_SPARKS = 10;
/** 정화 파동 고리를 이루는 점 개수(반경이 커서 성기면 고리로 안 보인다). */
const PURGE_RING_DOTS = 28;

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

/** 아이템 시드 = 공통 시드에서 파생. 화살 스트림과 섞이면 아이템 유무가 화살 패턴을
 *  밀어버린다 — 반드시 별도 스트림. 값은 임의의 큰 홀수 상수. */
const ITEM_SEED_SALT = 0x6a09e667;

/** 개인 화살을 계산할 대상(나 또는 관전 대상 남).
 *  x,y = 실제 사용(렌더·스폰) 위치. tx,ty = 네트워크로 받은 목표 위치.
 *  관전 대상은 매 틱 x,y를 tx,ty로 부드럽게 당겨(ease) 끊김 없이 움직인다.
 *  purge* = 정화 파동 연출(나는 내가 쓸 때, 남은 이벤트를 받았을 때). */
type Avatar = {
  x: number;
  y: number;
  tx: number;
  ty: number;
  pool: ArrowPool;
  spawner: PersonalSpawner;
  purgeFlash: number;
  purgeX: number;
  purgeY: number;
};

export class JungnimGame implements IGame {
  // 공통(시드) 레이어 — 모두 동일.
  private commonPool!: ArrowPool;
  private commonSpawner!: ArrowSpawner;
  // 개인 아바타: 나 + 관전 대상 남들. 전부 공유 personalSeed로 스포너를 만든다.
  private personalSeed = 0;
  private me!: Avatar;
  private readonly peers = new Map<string, Avatar>();

  private survivalTicks = 0;
  /** 공통 월드의 현재 tick. survivalTicks는 죽는 순간 멈추므로, 사망 뒤에도 계속
   *  도는 것(아이템 맥동·소멸 연출)은 이 값을 봐야 한다. */
  private worldTick = 0;
  private dead = false;

  /** 방해 발사를 주는 아이템. 스폰은 시드+tick, 획득은 로컬 판정. */
  private items!: ItemSpawner;
  // 아이템 효과(전부 나에게만 걸린다 — 공통 월드는 그대로).
  private dashTicks = 0; // 질주 잔여
  private focusTicks = 0; // 조준(개인) 화살 스폰 정지 잔여
  private shieldCharges = 0; // 남은 방어 횟수
  // 획득 연출: 아이템이 있던 자리에서 불꽃이 튄다.
  private pickupFlash = 0;
  private pickupX = 0;
  private pickupY = 0;
  private pickupColor = ITEM_COLOR;
  private pickupLabel = "";
  /** 남들 화면에도 보여야 할 시각 이벤트(앱이 위치 전송에 얹어 보낸다). 지금은 정화 하나. */
  private pendingPeerEvent: string | null = null;
  // 남의 발사에 맞아 걸린 조작계 디버프 잔여 tick.
  private invertTicks = 0;
  private sluggishTicks = 0;

  init(seed: number): void {
    this.commonPool = new ArrowPool(jungnimConfig.poolSize);
    this.commonSpawner = new ArrowSpawner(new SeededRNG(seed), jungnimConfig);
    this.items = new ItemSpawner(new SeededRNG((seed ^ ITEM_SEED_SALT) >>> 0), jungnimConfig);
    this.personalSeed = (seed ^ PERSONAL_SEED_SALT) >>> 0;
    this.me = this.newAvatar();
    this.centerAvatar(this.me);
    this.peers.clear();
    this.survivalTicks = 0;
    this.worldTick = 0;
    this.dead = false;
    this.dashTicks = 0;
    this.focusTicks = 0;
    this.shieldCharges = 0;
    this.pickupFlash = 0;
    this.pendingPeerEvent = null;
    this.invertTicks = 0;
    this.sluggishTicks = 0;
  }

  update(tick: number, input: InputState): void {
    this.worldTick = tick;
    // 살아있을 때만: 플레이어 이동 + 내 개인 스폰 + 피격 판정.
    if (!this.dead) {
      if (this.pickupFlash > 0) this.pickupFlash--;
      if (this.dashTicks > 0) this.dashTicks--;
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
      if (this.dashTicks > 0) s *= jungnimConfig.item.dash.speedMult;
      if (left) this.me.x -= s;
      if (right) this.me.x += s;
      if (up) this.me.y -= s;
      if (down) this.me.y += s;
      clampToArena(this.me); // 사각형이 아니라 원 안으로 가둔다.
      // 조준 정지 중엔 개인 화살을 새로 만들지 않는다(이미 날아온 건 그대로 온다).
      // ⚠️ 감소는 이 분기 안에서 — 밖에서 먼저 줄이면 마지막 tick에 한 발이 새어 나간다.
      if (this.focusTicks > 0) this.focusTicks--;
      else this.me.spawner.update(tick, this.me.pool, this.me.x, this.me.y);
    }
    this.moveArrows(this.me.pool);
    // 파동은 죽어도 끝까지 재생된다(연출이라 사망과 무관).
    if (this.me.purgeFlash > 0) this.me.purgeFlash--;

    // ⚠️ 공통 월드는 사망과 무관하게 항상 전진(남들과 안 어긋나게 + 관전 배경).
    // 아이템도 공통 월드다 — 내가 죽어도 계속 뜨고 사라진다(관전 화면에 그대로 보인다).
    this.commonSpawner.update(tick, this.commonPool);
    this.moveArrows(this.commonPool);
    this.items.update(tick);

    // 관전 대상(남)들: 네트워크 위치(tx,ty)로 부드럽게 당긴 뒤 개인 화살을 근사.
    // 위치가 ~10Hz라 매 틱 ease해야 점·화살이 끊기지 않는다.
    const s = jungnimConfig.spectateSmoothing;
    for (const peer of this.peers.values()) {
      peer.x += (peer.tx - peer.x) * s;
      peer.y += (peer.ty - peer.y) * s;
      peer.spawner.update(tick, peer.pool, peer.x, peer.y);
      this.moveArrows(peer.pool);
      if (peer.purgeFlash > 0) peer.purgeFlash--;
    }

    if (!this.dead) {
      const hit = this.findHit();
      if (hit) {
        // 쉴드가 남아 있으면 그 화살이 방패에 부딪혀 부서진다.
        // ⚠️ 부수지 않으면 겹친 채로 다음 tick에 또 맞아 3회가 한순간에 날아간다.
        if (this.shieldCharges > 0) {
          this.shieldCharges--;
          hit.pool.release(hit.arrow);
        } else {
          this.dead = true;
        }
      }
      if (!this.dead) this.takeItem(); // 죽는 프레임에 먹은 것으로 치지 않는다
      this.survivalTicks = tick; // 사망 프레임까지 포함 → 생존시간 = 사망 tick.
    }
  }

  /** 아이템에 닿았으면 가져가고 그 자리에서 효과가 걸린다(모아두지 않는다).
   *  ⚠️ 이 판정은 **내 위치**를 보므로 클라마다 결과가 다르다 — 그래서 아이템은
   *  각자 먹는 것이고, 스포너의 다음 스폰 일정은 여기서 절대 건드리지 않는다. */
  private takeItem(): void {
    const item = this.items.current;
    if (!item) return;
    const reach = jungnimConfig.playerRadius + jungnimConfig.item.radius;
    const dx = this.me.x - item.x;
    const dy = this.me.y - item.y;
    if (dx * dx + dy * dy > reach * reach) return;
    this.items.consume();
    this.pickupFlash = PICKUP_FLASH_TICKS; // 아이템이 있던 자리에서 불꽃
    this.pickupX = item.x;
    this.pickupY = item.y;
    this.pickupColor = kindColor(item.kind);
    this.pickupLabel = kindLabel(item.kind);
    this.applyItem(item.kind);
  }

  /** 아이템 효과. 전부 내 상태만 바꾼다 — purge만 예외로 내 화면의 화살을 지운다. */
  private applyItem(kind: string): void {
    const cfg = jungnimConfig.item;
    if (kind === "dash") {
      this.dashTicks = Math.max(this.dashTicks, cfg.dash.durationTicks);
    } else if (kind === "focus") {
      this.focusTicks = Math.max(this.focusTicks, cfg.focus.durationTicks);
    } else if (kind === "shield") {
      this.shieldCharges += cfg.shield.charges;
    } else if (kind === "purge") {
      this.purgeArrows(cfg.purge.radius);
      this.startPurgeRing(this.me);
      // 내 화면에서만 지운 화살이라, 나를 관전 중인 사람 화면에도 같은 파동을 재현하도록 알린다.
      this.pendingPeerEvent = "purge";
    }
    // 모르는 kind는 무시한다(종류가 늘어도 옛 판정이 안 죽는다).
  }

  /** 정화 파동을 그 아바타 자리에서 시작한다(나 또는 관전 대상 남). */
  private startPurgeRing(avatar: Avatar): void {
    avatar.purgeFlash = jungnimConfig.item.purge.ringTicks;
    avatar.purgeX = avatar.x;
    avatar.purgeY = avatar.y;
  }

  /** 내 주변 반경 안의 화살을 지운다. 개인 화살은 원래 내 것이고, 공통 화살은
   *  내 화면에서만 사라진다(관전자 화면엔 남는다 — config.item.purge 주석 참조). */
  private purgeArrows(radius: number): void {
    const radius2 = radius * radius;
    for (const pool of [this.commonPool, this.me.pool]) {
      for (const arrow of pool.items) {
        if (!arrow.active) continue;
        const dx = this.me.x - arrow.x;
        const dy = this.me.y - arrow.y;
        if (dx * dx + dy * dy <= radius2) pool.release(arrow);
      }
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
    this.drawArena(r);
    this.drawItem(r); // 화살보다 먼저 — 화살이 아이템 위를 지나가야 "위험을 뚫고 줍는" 그림이 된다
    // 내 화면에선 화살이 실제로 지워졌으니 걸러낼 게 없다 — 파동만 얹는다.
    this.drawPool(r, this.commonPool); // 공통 화살
    this.drawPool(r, this.me.pool); // 내 개인 화살
    this.drawPurgeRing(r, this.me);

    // 획득 불꽃은 주운 자리에 남는다(플레이어는 이미 다른 데로 움직였을 수 있다).
    if (!this.dead && this.pickupFlash > 0) this.drawPickupSparks(r);
    // 걸려 있는 효과는 플레이어 위에 짧게 적는다(피격 디버프 문구는 아래쪽이라 안 겹친다).
    if (!this.dead) this.drawActiveEffects(r);
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
      r.text(`사망 — 생존 ${formatTicks(this.survivalTicks)}`, cx - 90, cy, PLAYER_COLOR, 26);
    }
  }

  renderSpectator(r: IRenderer, target: SpectateTarget): void {
    this.drawArena(r);
    // ⚠️ 아이템은 내 인스턴스 기준이라, 관전 대상이 이미 먹은 아이템도 남아 보일 수 있다
    // (획득은 각자의 로컬 판정 — 개인 화살이 근사인 것과 같은 종류의 오차).
    this.drawItem(r);
    const peer = this.peers.get(target.id);
    // 그 사람이 정화를 썼다면, 퍼지는 파동 안쪽 화살을 빼고 그린다 — 그 사람 화면에선
    // 이미 없는 화살이다. 내 공통 풀은 그대로 두므로 내 판정엔 영향이 없다.
    const ring = peer ? this.purgeRingRadius(peer) : null;
    const skip = peer && ring !== null ? { x: peer.purgeX, y: peer.purgeY, radius: ring } : undefined;
    this.drawPool(r, this.commonPool, skip); // 공통 화살(모두 동일)
    // 점·화살 모두 ease된 위치(peer.x,y)로 그려 부드럽게. 없으면 target 좌표 폴백.
    const dotX = peer ? peer.x : target.x;
    const dotY = peer ? peer.y : target.y;
    if (peer) {
      this.drawPool(r, peer.pool, skip); // 그 사람의 개인(조준) 화살 시각 근사
      this.drawPurgeRing(r, peer);
    }
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

  /** 앱이 매 위치 전송마다 물어본다: 남들 화면에도 재현돼야 할 이벤트가 있으면 한 번 준다. */
  consumePeerEvent(): string | null {
    const event = this.pendingPeerEvent;
    this.pendingPeerEvent = null;
    return event;
  }

  /** 남이 낸 이벤트가 도착했다. 그 사람을 관전 중이면 같은 파동이 그 자리에서 퍼진다.
   *  ⚠️ 판정과 무관한 연출 — 유실돼도 게임 진행은 갈리지 않는다(그 사람 화면만 덜 맞아 보일 뿐). */
  applyPeerEvent(id: string, kind: string): void {
    if (kind !== "purge") return; // 모르는 이벤트는 무시(종류가 늘어도 옛 클라가 안 죽는다)
    const peer = this.peers.get(id);
    if (peer) this.startPurgeRing(peer);
  }

  /** 남의 발사에 맞았다. 아는 조작계 디버프면 지속시간(ms)만큼 로컬에 건다 — invert(좌우
   *  반전)·sluggish(이동 둔화). 시각계(blur·shake·cloud)는 앱이 화면에 처리하므로 여기선
   *  무시한다(모르는 kind도 무시 → 효과가 늘어도 옛 클라가 안 죽는다). 이미 죽었으면 무시.
   *  결정론 안전: 내 입력·속도만 바꿀 뿐 공통 월드는 안 건드린다. */
  applyEffect(kind: string, durationMs: number): void {
    if (this.dead) return;
    const ticks = Math.round((durationMs / 1000) * TICKS_PER_SECOND);
    if (kind === "invert") this.invertTicks = Math.max(this.invertTicks, ticks);
    else if (kind === "sluggish") this.sluggishTicks = Math.max(this.sluggishTicks, ticks);
  }

  // ---- 내부 ----

  /** 떠 있는 아이템: 맥동하는 금색 원 + 십자 반짝임. 사라지기 직전엔 깜빡인다.
   *  전부 tick의 함수라 관전 화면에서도 같은 모습으로 보인다(렌더 전용 — 판정과 무관). */
  private drawItem(r: IRenderer): void {
    const item = this.items.current;
    if (!item) return;
    const age = this.worldTick - item.bornTick;
    const left = item.expireTick - this.worldTick;
    // 곧 사라지는 동안 8tick 주기로 깜빡 — 한 프레임 걸러 그리지 않는다.
    if (left < ITEM_FADE_TICKS && Math.floor(left / 8) % 2 === 1) return;

    const pulse = 1 + Math.sin((age / ITEM_PULSE_TICKS) * Math.PI * 2) * ITEM_PULSE_AMOUNT;
    // 등장 직후엔 0에서 부풀어 오른다(ease-out). 탄막 한복판에 조용히 나타나면 못 본다.
    const pop = Math.min(1, age / ITEM_POP_TICKS);
    const radius = jungnimConfig.item.radius * pulse * pop * (2 - pop);
    const color = kindColor(item.kind); // 종류마다 색이 달라 멀리서도 무엇인지 안다
    r.circle(item.x, item.y, radius, color);
    const spike = radius + 5;
    r.line(item.x - spike, item.y, item.x + spike, item.y, color, 2);
    r.line(item.x, item.y - spike, item.x, item.y + spike, color, 2);
  }

  /** 획득 순간: 아이템이 있던 자리에서 불꽃이 사방으로 튀며 작아진다.
   *  발사 버스트(플레이어에 붙음)와 자리가 달라, "여기서 주웠고 → 내가 쐈다"가 함께 읽힌다. */
  private drawPickupSparks(r: IRenderer): void {
    const progress = 1 - this.pickupFlash / PICKUP_FLASH_TICKS; // 0(막 주움) → 1(끝)
    const ring = jungnimConfig.item.radius + progress * 40;
    const spark = 4 * (1 - progress);
    for (let i = 0; i < PICKUP_SPARKS; i++) {
      const angle = ((Math.PI * 2) / PICKUP_SPARKS) * i;
      r.circle(this.pickupX + Math.cos(angle) * ring, this.pickupY + Math.sin(angle) * ring, spark, this.pickupColor);
    }
    // 무엇을 주웠는지 그 자리에 적는다. 지속 효과가 없는 정화는 이 한 번이 유일한 이름표다.
    r.text(`${this.pickupLabel}!`, this.pickupX + 14, this.pickupY - 14 - progress * 12, this.pickupColor, 16);
  }

  /** 지금 걸려 있는 효과를 플레이어 위에 한 줄씩. 쉴드는 남은 횟수까지 보여준다
   *  — 몇 대 더 버티는지가 곧 다음 판단이라 숫자가 필요하다. */
  private drawActiveEffects(r: IRenderer): void {
    let line = 0;
    const put = (text: string, color: string): void => {
      r.text(text, this.me.x + 12, this.me.y - 28 - line * 16, color, 14);
      line++;
    };
    if (this.shieldCharges > 0) put(`${kindLabel("shield")} ${this.shieldCharges}`, kindColor("shield"));
    if (this.dashTicks > 0) put(kindLabel("dash"), kindColor("dash"));
    if (this.focusTicks > 0) put(kindLabel("focus"), kindColor("focus"));
  }

  private newAvatar(): Avatar {
    return {
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      pool: new ArrowPool(jungnimConfig.poolSize),
      spawner: new PersonalSpawner(new SeededRNG(this.personalSeed), jungnimConfig),
      purgeFlash: 0,
      purgeX: 0,
      purgeY: 0,
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

  /** skip이 있으면 그 원 안의 화살은 안 그린다 — 남의 정화 파동을 내 화면에서 흉내 낼 때 쓴다.
   *  (그 사람은 실제로 지웠지만 내 공통 풀엔 남아 있다. 지우면 내 판정까지 바뀐다.) */
  private drawPool(r: IRenderer, pool: ArrowPool, skip?: { x: number; y: number; radius: number }): void {
    const skip2 = skip ? skip.radius * skip.radius : 0;
    for (const a of pool.items) {
      if (!a.active) continue;
      if (skip) {
        const dx = a.x - skip.x;
        const dy = a.y - skip.y;
        if (dx * dx + dy * dy <= skip2) continue;
      }
      this.drawArrow(r, a);
    }
  }

  /** 지금 퍼지고 있는 정화 파동의 반경(없으면 null). tick의 함수라 어느 화면에서든 같다. */
  private purgeRingRadius(avatar: Avatar): number | null {
    if (avatar.purgeFlash <= 0) return null;
    const { radius, ringTicks } = jungnimConfig.item.purge;
    const progress = 1 - avatar.purgeFlash / ringTicks; // 0(막 씀) → 1(끝)
    // 점이 아니라 **몸에서** 퍼져나간다 — 0에서 시작하면 첫 프레임이 한 점에 뭉쳐 얼룩처럼 보인다.
    const from = jungnimConfig.playerRadius;
    return from + (radius - from) * progress;
  }

  /** 정화 파동: 그 자리에서 금색 고리가 반경까지 퍼지며 옅어진다. */
  private drawPurgeRing(r: IRenderer, avatar: Avatar): void {
    const ring = this.purgeRingRadius(avatar);
    if (ring === null) return;
    const dot = 5 * (avatar.purgeFlash / jungnimConfig.item.purge.ringTicks);
    for (let i = 0; i < PURGE_RING_DOTS; i++) {
      const angle = ((Math.PI * 2) / PURGE_RING_DOTS) * i;
      r.circle(avatar.purgeX + Math.cos(angle) * ring, avatar.purgeY + Math.sin(angle) * ring, dot, kindColor("purge"));
    }
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
  /** 나를 맞힌 화살과 그 풀(없으면 null). 쉴드가 그 한 발만 부수려면 어느 화살인지 알아야 한다. */
  private findHit(): { arrow: Arrow; pool: ArrowPool } | null {
    const hitR = jungnimConfig.playerRadius + jungnimConfig.arrowRadius;
    const hitR2 = hitR * hitR;
    for (const pool of [this.commonPool, this.me.pool]) {
      const arrow = this.hitInPool(pool, hitR2);
      if (arrow) return { arrow, pool };
    }
    return null;
  }

  private hitInPool(pool: ArrowPool, hitR2: number): Arrow | null {
    for (const a of pool.items) {
      if (!a.active) continue;
      const dx = this.me.x - a.x;
      const dy = this.me.y - a.y;
      if (dx * dx + dy * dy <= hitR2) return a;
    }
    return null;
  }
}

/** 아이템 종류의 표시색·이름. 모르는 종류면 기본값(종류가 늘어도 옛 판정이 안 죽는다). */
function kindColor(kind: string): string {
  return jungnimConfig.item.kinds.find((entry) => entry.kind === kind)?.color ?? ITEM_COLOR;
}

function kindLabel(kind: string): string {
  return jungnimConfig.item.kinds.find((entry) => entry.kind === kind)?.label ?? "아이템";
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
