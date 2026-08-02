/* ============================================================
   CurveGame — 커브 피버 (IGame 구현)
   ------------------------------------------------------------
   내 선 하나. 좌/우 회전, 꼬리 기록, 자기 꼬리·벽·장애물 충돌.

   남의 꼬리는 관전 뷰에서 재구성해 그린다(syncPeers로 오는 10Hz 위치를
   이어 붙인 폴리라인 = 시각적 근사). ⚠️ 판정엔 쓰지 않는다 — 이 프레임워크는
   "같은 시드 → 각자 독립 시뮬 + 위치는 관전용 중계"라, 남 꼬리 충돌은 락스텝
   입력 동기가 있어야 결정론이 유지된다(DESIGN 10절). 그래서 죽림고수와 똑같이
   내 화면(render)은 나만, 남은 renderSpectator에서만 보인다.

   장애물은 선분 벽 + 꽉 찬 원 기둥 두 종류(obstacles.ts). 전부 시드에서만
   파생되는 공통 월드라, 스폰보다 먼저 뽑아 모든 클라에서 같은 판이 나온다.

   결정론 불변식: update는 tick + input에서만 파생된다. Math.random 없음.
   같은 시드 + 같은 입력이면 어느 클라에서 돌려도 꼬리가 픽셀 단위로 같다.
   ============================================================ */

import type { IGame, IRenderer, InputState, PeerState, SpawnContext, SpectateTarget } from "@arcade/shared";
import { TICKS_PER_SECOND, formatTicks } from "@arcade/shared";
import { SeededRNG } from "@arcade/core";
import { curveConfig as C } from "./config";
import { drawObstacle, obstacleBlocks, obstacleClearance, type Obstacle } from "./obstacles";

const TAU = Math.PI * 2;

const ARENA_FLOOR = "#1e2230";
const WALL_COLOR = "#457b9d";
const MY_COLOR = "#e63946";
const HEAD_COLOR = "#ffd166";
const HUD_COLOR = "#e6e6e6";
const GRAZE_COLOR = "#ffd166"; // 스치는 순간(니어 미스) 강조 팝업
const FIRE_COLOR = "#fff3b0"; // 발사 순간 번쩍임 + 총알 트레이서
/** 발사 연출이 지속되는 tick 수(≈0.33초). 이 동안 게이지 번쩍 + 트레이서. */
const FIRE_FLASH_TICKS = 20;
/** 스침 소리 사이의 최소 간격(tick). 0.25초 — 계속 스쳐도 초당 4번을 넘지 않는다. */
const GRAZE_SOUND_COOLDOWN_TICKS = 15;
const INVERT_COLOR = "#c77dff"; // 좌우반전 피격 중 표시색
const SLUGGISH_COLOR = "#4dd0e1"; // 조작 둔화 피격 중 표시색
/** 남 꼬리 색 — 입장 순서대로 돌려 쓴다(관전 화면에서 서로 구분되게). */
const PEER_COLORS = ["#f4a261", "#2a9d8f", "#e9c46a", "#a8dadc", "#c77dff", "#90be6d"];

/** 플레이어 머리 반경 = 선 절반 두께. 충돌·탐침의 pad로 쓴다. */
const HEAD_R = C.lineWidth / 2;
/** 선분 장애물의 반 두께. */
const SEG_HALF = C.obstacleWidth / 2;

export class CurveGame implements IGame {
  // 머리(현재 위치)와 진행 방향.
  private x = 0;
  private y = 0;
  private angle = 0;

  // 꼬리 좌표. 매 tick 머리 위치를 한 점씩 쌓는다.
  // 병렬 배열로 두어 긴 라운드에서도 점당 객체 할당이 없게 한다.
  private trailX: number[] = [];
  private trailY: number[] = [];

  // 장애물(선분 벽 + 원 기둥). 시드에서만 파생 → 모두가 같은 판.
  private obstacles: Obstacle[] = [];

  // 남들의 꼬리(관전용 재구성). syncPeers로 오는 10Hz 위치를 병렬 배열로 쌓아
  // 폴리라인으로 잇는다. 판정에는 절대 쓰지 않는다(시각 근사).
  private peerTrails = new Map<string, { xs: number[]; ys: number[]; color: string; label: string }>();

  private dead = false;
  private survivalTicks = 0;

  // 「스릴 게이지」(0~1). 벽·꼬리·장애물을 아슬아슬하게 스칠 때(니어 미스)마다 찬다.
  // 꽉 차면 상대에게 발사하고 0으로. grazing은 이번 tick 스치는 중인지(문구 표시용).
  private gauge = 0;
  private grazing = false;
  // 발사 연출 잔여 tick(>0이면 게이지 번쩍 + 총알 트레이서). tick마다 준다.
  private fireFlash = 0;
  // 마지막으로 방향을 튼 뒤 흐른 tick. 오래 직진만 하면(벽타기) 충전을 끊는 데 쓴다.
  private ticksSinceTurn = 0;
  // 이번에 게이지가 꽉 차 상대에게 쏠 발사가 대기 중인지. 러너가 consumePendingFire로 가져가
  // 네트워크로 내보낸다. 로컬 발사 연출(fireFlash)과 별개 — 이건 "남에게 전송" 신호다.
  private pendingFire = false;
  // 남의 발사에 맞아 좌우 조작이 반전되는 잔여 tick(>0이면 left/right를 뒤집는다).
  private invertTicks = 0;
  // 남의 발사에 맞아 회전이 둔해지는 잔여 tick(>0이면 turnRate가 배수만큼 줄어든다).
  private sluggishTicks = 0;
  /** 이번 스텝에 낼 소리. Set이라 어휘 수만큼만 커진다 — 아무도 안 가져가도 안 쌓인다. */
  private readonly sounds = new Set<string>();
  /** 스침 소리를 다시 낼 수 있을 때까지 남은 tick. 스침은 **지속 상태**라 그냥 두면
   *  벽을 타는 내내 초당 60번 울린다. tick 기반이라 결정론과 무관하고, 이 값은
   *  어디에도 되먹임되지 않는다 — 소리 말고는 아무것도 바꾸지 않는다. */
  private grazeSoundCooldown = 0;

  init(seed: number, self?: SpawnContext): void {
    const rng = new SeededRNG(seed);
    // ⚠️ 순서가 중요하다: 장애물을 **먼저** 뽑는다. 장애물은 플레이어와 무관한
    //    공통 월드라, 스폰(플레이어별로 달라질 수 있음)보다 앞서 정해져야
    //    모든 클라에서 같은 판이 나온다. (멀티에서 스폰이 갈려도 판은 안 갈린다)
    this.obstacles = this.generateObstacles(rng);
    // 솔로(self 없음)면 기존 단일 스폰 그대로 — 동작·RNG 소비가 바이트 단위로 동일.
    // 멀티면 인원수만큼 서로 떨어진 스폰을 결정론적으로 뽑아(모든 클라 동일 집합)
    // 내 순번의 자리를 고른다 → 시작점이 겹치지 않는다.
    const spawn = self && self.count > 1 ? this.generateSpawns(rng, self.count)[clamp(self.index, 0, self.count - 1)]! : this.pickSafeSpawn(rng);
    this.x = spawn.x;
    this.y = spawn.y;
    // 랜덤 방향이면 벽·장애물을 정면으로 향해 즉사할 수 있다. 주변을 훑어
    // "가장 트인 쪽"으로 출발시킨다.
    this.angle = this.chooseOpenHeading(rng, spawn.x, spawn.y);

    this.trailX = [this.x];
    this.trailY = [this.y];
    this.peerTrails.clear(); // 새 라운드 — 지난 판의 남 꼬리를 비운다.
    this.dead = false;
    this.survivalTicks = 0;
    this.gauge = 0;
    this.grazing = false;
    this.fireFlash = 0;
    this.ticksSinceTurn = 0;
    this.pendingFire = false;
    this.sounds.clear();
    this.grazeSoundCooldown = 0;
    this.invertTicks = 0;
    this.sluggishTicks = 0;
  }

  /** 장애물을 시드에서 뽑는다. 벽붙은 선분 → 떠 있는 선분 → 원 기둥 순.
   *  ⚠️ 이 고정 순서를 지켜야 클라마다 같은 판이 나온다. */
  private generateObstacles(rng: SeededRNG): Obstacle[] {
    const { count, wallAttachedCount, minLength, maxLength, edgeMargin, circleCount, polygonCount } = C.obstacles;
    const out: Obstacle[] = [];
    const attached = Math.min(wallAttachedCount, count);
    // 처음 4개는 네 변(0=위 1=오른쪽 2=아래 3=왼쪽)에 하나씩 배정해 모든 변이
    // 최소 하나는 갖게 한다(둘레 어디로도 그냥 돌 수 없게). 나머지는 랜덤 변.
    for (let i = 0; i < attached; i++) {
      const wall = i < 4 ? i : rng.int(4);
      out.push(this.wallAttachedSegment(rng, wall));
    }
    for (let i = attached; i < count; i++) out.push(this.floatingSegment(rng, minLength, maxLength, edgeMargin));
    for (let i = 0; i < circleCount; i++) out.push(this.circlePillar(rng));
    for (let i = 0; i < polygonCount; i++) out.push(this.polygonRing(rng));
    return out;
  }

  /** 바깥 벽 한 곳(wall: 0=위 1=오른쪽 2=아래 3=왼쪽)에 한쪽 끝을 붙이고
   *  안쪽으로 뻗는 선분(벽에서 자란 돌기). */
  private wallAttachedSegment(rng: SeededRNG, wall: number): Obstacle {
    const { minLength, maxLength } = C.obstacles;
    const m = C.wallMargin;
    const W = C.screenWidth;
    const H = C.screenHeight;
    const pad = 80; // 벽을 따라 모서리에서 이만큼 떨어진 구간에만 붙인다.
    let bx = 0;
    let by = 0;
    let inward = 0; // 안쪽을 향하는 기준 각도
    if (wall === 0) { bx = rng.range(m + pad, W - m - pad); by = m; inward = Math.PI / 2; }
    else if (wall === 1) { bx = W - m; by = rng.range(m + pad, H - m - pad); inward = Math.PI; }
    else if (wall === 2) { bx = rng.range(m + pad, W - m - pad); by = H - m; inward = -Math.PI / 2; }
    else { bx = m; by = rng.range(m + pad, H - m - pad); inward = 0; }

    // 안쪽 방향에 ±34° 변화를 줘 수직 스파이크가 아니라 비스듬하게도 자라게 한다.
    const angle = inward + rng.range(-0.6, 0.6);
    const length = rng.range(minLength, maxLength);
    const fx = clamp(bx + Math.cos(angle) * length, m, W - m);
    const fy = clamp(by + Math.sin(angle) * length, m, H - m);
    return { kind: "segment", x1: bx, y1: by, x2: fx, y2: fy };
  }

  /** 판 안쪽에 떠 있는 선분. 끝점은 바깥 벽에서 edgeMargin만큼 안쪽. */
  private floatingSegment(rng: SeededRNG, minLength: number, maxLength: number, edgeMargin: number): Obstacle {
    const lo = C.wallMargin + edgeMargin;
    const hiX = C.screenWidth - C.wallMargin - edgeMargin;
    const hiY = C.screenHeight - C.wallMargin - edgeMargin;
    const x1 = rng.range(lo, hiX);
    const y1 = rng.range(lo, hiY);
    const angle = rng.next() * TAU;
    const length = rng.range(minLength, maxLength);
    const x2 = clamp(x1 + Math.cos(angle) * length, lo, hiX);
    const y2 = clamp(y1 + Math.sin(angle) * length, lo, hiY);
    return { kind: "segment", x1, y1, x2, y2 };
  }

  /** 꽉 찬 원 기둥. 원 전체가 안전 영역 안에 들어오도록 중심을 반지름만큼 띄운다. */
  private circlePillar(rng: SeededRNG): Obstacle {
    const { circleMinRadius, circleMaxRadius } = C.obstacles;
    const r = rng.range(circleMinRadius, circleMaxRadius);
    const cx = rng.range(C.wallMargin + r, C.screenWidth - C.wallMargin - r);
    const cy = rng.range(C.wallMargin + r, C.screenHeight - C.wallMargin - r);
    return { kind: "circle", cx, cy, r };
  }

  /** 속 빈 다각형(정다각형 + 전체 회전). 윤곽선만 벽이라 안에 들어갔다 나올 수 있다. */
  private polygonRing(rng: SeededRNG): Obstacle {
    const { polygonMinRadius, polygonMaxRadius, polygonMinSides, polygonMaxSides } = C.obstacles;
    const sides = polygonMinSides + rng.int(polygonMaxSides - polygonMinSides + 1);
    const radius = rng.range(polygonMinRadius, polygonMaxRadius);
    // 도형 전체가 안전 영역에 들어오도록 중심을 반지름만큼 띄운다.
    const cx = rng.range(C.wallMargin + radius, C.screenWidth - C.wallMargin - radius);
    const cy = rng.range(C.wallMargin + radius, C.screenHeight - C.wallMargin - radius);
    const rot = rng.next() * TAU;
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i * TAU) / sides;
      pts.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    }
    return { kind: "polygon", pts };
  }

  /** 시작 위치를 뽑는다. spawnClearance를 만족하는 자리를 찾으면 즉시 쓰고,
   *  못 찾으면(밀도가 높아 꽉 찬 경우) **그나마 가장 트인** 후보를 쓴다.
   *  ⚠️ 예전엔 못 찾으면 마지막 랜덤 후보를 그대로 써서, 밀도가 오르자
   *     벽·장애물 코앞에 스폰돼 즉사하는 일이 생겼다. */
  private pickSafeSpawn(rng: SeededRNG): { x: number; y: number } {
    const minX = C.wallMargin + C.spawnInset;
    const maxX = C.screenWidth - C.wallMargin - C.spawnInset;
    const minY = C.wallMargin + C.spawnInset;
    const maxY = C.screenHeight - C.wallMargin - C.spawnInset;

    let best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    let bestClear = -Infinity;
    for (let attempt = 0; attempt < C.obstacles.maxSpawnAttempts; attempt++) {
      const x = rng.range(minX, maxX);
      const y = rng.range(minY, maxY);
      // 이 후보에서 가장 가까운 장애물까지의 여유거리.
      let minClear = Infinity;
      for (const ob of this.obstacles) {
        const c = obstacleClearance(ob, x, y, SEG_HALF);
        if (c < minClear) minClear = c;
      }
      if (minClear >= C.obstacles.spawnClearance) return { x, y }; // 충분히 트임 → 확정
      if (minClear > bestClear) {
        bestClear = minClear;
        best = { x, y };
      }
    }
    return best; // 기준 미달이지만 표본 중 가장 트인 자리
  }

  /** 멀티용: 서로 떨어진 스폰 count개를 순서대로 뽑는다. 앞서 정한 자리들과도
   *  멀어지도록 골라 시작점이 겹치지 않게 한다. 결정론적이라 모든 클라가 같은
   *  집합을 얻고, 각자 자기 순번(index)의 자리를 쓴다. */
  private generateSpawns(rng: SeededRNG, count: number): { x: number; y: number }[] {
    const chosen: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) chosen.push(this.pickSpreadSpawn(rng, chosen));
    return chosen;
  }

  /** 장애물에서 충분히 트이면서 already(이미 고른 스폰들)에서 가장 먼 자리를 고른다.
   *  트인 후보가 하나라도 있으면 그중 남들과 가장 먼 것을, 하나도 없으면(꽉 참)
   *  그나마 장애물 여유가 가장 큰 자리를 쓴다. */
  private pickSpreadSpawn(rng: SeededRNG, already: readonly { x: number; y: number }[]): { x: number; y: number } {
    const minX = C.wallMargin + C.spawnInset;
    const maxX = C.screenWidth - C.wallMargin - C.spawnInset;
    const minY = C.wallMargin + C.spawnInset;
    const maxY = C.screenHeight - C.wallMargin - C.spawnInset;

    let bestGood: { x: number; y: number } | null = null;
    let bestGoodDist = -Infinity; // 트인 후보 중 남들과의 최소거리 최대화
    let bestBad = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    let bestBadClear = -Infinity; // 트인 후보가 없을 때의 폴백(장애물 여유 최대)

    for (let attempt = 0; attempt < C.obstacles.maxSpawnAttempts; attempt++) {
      const x = rng.range(minX, maxX);
      const y = rng.range(minY, maxY);
      let obClear = Infinity;
      for (const ob of this.obstacles) {
        const c = obstacleClearance(ob, x, y, SEG_HALF);
        if (c < obClear) obClear = c;
      }
      if (obClear >= C.obstacles.spawnClearance) {
        let peerDist = Infinity;
        for (const o of already) {
          const d = Math.hypot(x - o.x, y - o.y);
          if (d < peerDist) peerDist = d;
        }
        if (peerDist > bestGoodDist) {
          bestGoodDist = peerDist;
          bestGood = { x, y };
        }
      } else if (obClear > bestBadClear) {
        bestBadClear = obClear;
        bestBad = { x, y };
      }
    }
    return bestGood ?? bestBad;
  }

  /** 시작 위치에서 사방을 훑어 "가장 트인 방향"을 고른다. 각 후보 방향으로 짧은
   *  탐침을 쏘아 벽·장애물에 막힐 때까지의 거리를 재고, 그게 가장 큰 방향을 쓴다.
   *  rng는 후보 각도의 시작 오프셋 하나만 소비한다(판마다 방향이 달라지게). */
  private chooseOpenHeading(rng: SeededRNG, x: number, y: number): number {
    const { headingSamples, spawnClearance } = C.obstacles;
    const offset = rng.next() * TAU;
    const step = 8; // 탐침 간격(px)
    const maxProbe = spawnClearance + 40;

    let bestAngle = offset;
    let bestClear = -1;
    for (let k = 0; k < headingSamples; k++) {
      const a = offset + (k * TAU) / headingSamples;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      let clear = maxProbe;
      for (let d = step; d <= maxProbe; d += step) {
        if (this.blockedAt(x + cos * d, y + sin * d)) {
          clear = d;
          break;
        }
      }
      if (clear > bestClear) {
        bestClear = clear;
        bestAngle = a;
      }
    }
    return bestAngle;
  }

  /** 탐침용: (px,py)가 벽 밖이거나 장애물에 닿는가(머리 반경 기준). */
  private blockedAt(px: number, py: number): boolean {
    if (px < C.wallMargin || px > C.screenWidth - C.wallMargin || py < C.wallMargin || py > C.screenHeight - C.wallMargin) {
      return true;
    }
    for (const ob of this.obstacles) {
      if (obstacleBlocks(ob, px, py, HEAD_R, SEG_HALF)) return true;
    }
    return false;
  }

  update(tick: number, input: InputState): void {
    if (this.dead) return; // 죽으면 내 선은 멈춘다(꼬리는 그대로 남아 장애물).

    // 남의 발사에 맞은 동안 디버프를 건다. 모두 이 클라의 입력/회전만 바꾸므로
    // (각자 시뮬은 원래 독립) 결정론이 깨지지 않는다 — 벌은 나만 받는다.
    // invert: 좌/우를 뒤집는다. sluggish: 회전 각도를 배수만큼 줄여 굼뜨게 한다.
    let left = input.left;
    let right = input.right;
    if (this.invertTicks > 0) {
      this.invertTicks--;
      [left, right] = [right, left];
    }
    let turn = C.turnRate;
    if (this.sluggishTicks > 0) {
      this.sluggishTicks--;
      turn *= C.fire.sluggishTurnMult;
    }

    // 좌/우 입력이 있을 때만 방향을 튼다. 둘 다거나 없으면 직진.
    // 방향을 틀면 "스침 충전" 유예 시계를 리셋한다(직진만 하면 시계가 흘러 충전이 끊긴다).
    if (left && !right) {
      this.angle -= turn;
      this.ticksSinceTurn = 0;
    } else if (right && !left) {
      this.angle += turn;
      this.ticksSinceTurn = 0;
    } else {
      this.ticksSinceTurn++;
    }

    this.x += Math.cos(this.angle) * C.speed;
    this.y += Math.sin(this.angle) * C.speed;
    this.trailX.push(this.x);
    this.trailY.push(this.y);

    if (this.hitWall() || this.hitOwnTrail() || this.hitObstacle()) {
      this.dead = true;
      return;
    }
    this.survivalTicks = tick;
    this.accrueNearMiss();
  }

  /** 「니어 미스」: 살아남았지만 벽·꼬리·장애물에 충돌 직전까지 스쳤으면 게이지를 채운다.
   *  가까울수록 빨리 차고, 꽉 차면(=1) 상대에게 쏠 발사를 예약하고 0으로 리셋된다
   *  (consumePendingFire). 판정은 순수 기하라 클라마다 어긋나지 않는다. */
  private accrueNearMiss(): void {
    if (this.fireFlash > 0) this.fireFlash--; // 발사 연출 시간 경과
    if (this.grazeSoundCooldown > 0) this.grazeSoundCooldown--;
    const { grazeBand, gaugeGain, turnGraceTicks } = C.nearMiss;
    // 벽타기(오래 직진) 무한 충전 방지: 최근에 방향을 튼 적이 있어야 스침이 충전된다.
    if (this.ticksSinceTurn >= turnGraceTicks) {
      this.grazing = false;
      return;
    }
    const gap = this.nearestHazardGap();
    this.grazing = gap > 0 && gap <= grazeBand;
    if (!this.grazing) return;
    // 스치는 내내가 아니라 쿨다운마다 한 번. 아슬아슬함을 알리는 짧은 신호지 지속음이 아니다.
    if (this.grazeSoundCooldown === 0) {
      this.sounds.add("graze");
      this.grazeSoundCooldown = GRAZE_SOUND_COOLDOWN_TICKS;
    }
    this.gauge += nearMissGain(gap, grazeBand, gaugeGain);
    if (this.gauge >= 1) {
      this.gauge = 0;
      this.fireFlash = FIRE_FLASH_TICKS; // 발사! — 연출 시작
      this.sounds.add("fire");
      this.pendingFire = true; // 러너가 가져가 조준한 상대 1명에게 방해 효과를 쏜다(멀티).
    }
  }

  /** 머리에서 가장 가까운 죽음의 경계까지의 여유(px). 벽·장애물·자기 꼬리 중 최소.
   *  음수면 이미 충돌(죽음)이지만, 이 함수는 살아있을 때만 불린다. */
  private nearestHazardGap(): number {
    // 벽: 머리 가장자리와 안쪽 벽 경계 사이 간격.
    let gap = Math.min(
      this.x - HEAD_R - C.wallMargin,
      C.screenWidth - C.wallMargin - (this.x + HEAD_R),
      this.y - HEAD_R - C.wallMargin,
      C.screenHeight - C.wallMargin - (this.y + HEAD_R),
    );
    // 장애물: 표면까지 거리에서 머리 반경을 뺀 값(obstacleBlocks와 같은 기준).
    for (const ob of this.obstacles) {
      const g = obstacleClearance(ob, this.x, this.y, SEG_HALF) - HEAD_R;
      if (g < gap) gap = g;
    }
    // 자기 꼬리: 면제 구간 밖에서 가장 가까운 점까지 거리 - 선 두께(hitOwnTrail과 같은 기준).
    const last = this.trailX.length - 1 - C.selfImmuneTrailPoints;
    for (let i = 0; i <= last; i++) {
      const dx = this.x - this.trailX[i]!;
      const dy = this.y - this.trailY[i]!;
      const g = Math.hypot(dx, dy) - C.lineWidth;
      if (g < gap) gap = g;
    }
    return gap;
  }

  private hitWall(): boolean {
    return (
      this.x - HEAD_R < C.wallMargin ||
      this.x + HEAD_R > C.screenWidth - C.wallMargin ||
      this.y - HEAD_R < C.wallMargin ||
      this.y + HEAD_R > C.screenHeight - C.wallMargin
    );
  }

  /** 머리가 자기 꼬리에 닿았나. 머리 바로 뒤 selfImmuneTrailPoints개는 면제한다
   *  — 머리에 가장 가까운 꼬리는 원래 붙어 있어, 면제 없이는 매 tick 즉사한다. */
  private hitOwnTrail(): boolean {
    const threshold = C.lineWidth * C.lineWidth; // 제곱 비교(sqrt 회피)
    const last = this.trailX.length - 1 - C.selfImmuneTrailPoints;
    for (let i = 0; i <= last; i++) {
      const dx = this.x - this.trailX[i]!;
      const dy = this.y - this.trailY[i]!;
      if (dx * dx + dy * dy < threshold) return true;
    }
    return false;
  }

  /** 머리가 장애물(선분·원)에 닿았나. */
  private hitObstacle(): boolean {
    for (const ob of this.obstacles) {
      if (obstacleBlocks(ob, this.x, this.y, HEAD_R, SEG_HALF)) return true;
    }
    return false;
  }

  render(r: IRenderer, _alpha: number): void {
    this.drawArena(r);
    this.drawTrail(r, this.trailX, this.trailY, MY_COLOR);
    // 발사/스침 손맛은 머리 옆에 위치성으로 남긴다(게이지·시간은 캔버스 밖 DOM HUD).
    if (!this.dead && this.fireFlash > 0) {
      this.drawFireTracer(r); // 진행 방향으로 총알 트레이서
      r.text("발사!", this.x + 10, this.y - 26, FIRE_COLOR, 16);
    } else if (!this.dead && this.grazing) {
      r.text("스릴!", this.x + 10, this.y - 10, GRAZE_COLOR, 14); // 게이지가 차는 니어 미스
    }
    // 조작계 디버프 피격 중: 머리를 디버프색으로 바꾸고 머리 옆에 경고 문구를 띄운다
    // (화면 전체 배너는 앱이 따로 그린다 — 여기선 지속 표시로 머리에 남긴다).
    if (!this.dead && this.invertTicks > 0) {
      r.text("조작 반전!", this.x + 10, this.y + 22, INVERT_COLOR, 15);
      r.circle(this.x, this.y, C.lineWidth, INVERT_COLOR);
    } else if (!this.dead && this.sluggishTicks > 0) {
      r.text("조작 둔화!", this.x + 10, this.y + 22, SLUGGISH_COLOR, 15);
      r.circle(this.x, this.y, C.lineWidth, SLUGGISH_COLOR);
    } else if (!this.dead) {
      r.circle(this.x, this.y, C.lineWidth, HEAD_COLOR);
    }
    // 사망 피드백 — 죽림고수와 같은 중앙 문구(그동안 머리만 사라져 죽은 줄 몰랐다).
    if (this.dead) {
      const cx = C.screenWidth / 2;
      const cy = C.screenHeight / 2;
      r.text(`사망 — 생존 ${formatTicks(this.survivalTicks)}`, cx - 90, cy, MY_COLOR, 26);
    }
  }

  private drawArena(r: IRenderer): void {
    r.clear();
    // 바깥은 벽 색(죽음의 경계), 안쪽은 바닥. 경계선이 곧 벽이다.
    r.rect(0, 0, C.screenWidth, C.screenHeight, WALL_COLOR);
    r.rect(
      C.wallMargin,
      C.wallMargin,
      C.screenWidth - C.wallMargin * 2,
      C.screenHeight - C.wallMargin * 2,
      ARENA_FLOOR,
    );
    // 장애물. 바깥 벽과 같은 색이라 "부딪히면 죽는 벽"으로 읽힌다.
    for (const ob of this.obstacles) drawObstacle(r, ob, WALL_COLOR, C.obstacleWidth);
  }

  /** 발사 순간 총알 트레이서 — 머리에서 진행 방향으로 밝은 선이 뻗었다 사그라든다.
   *  fireFlash가 줄수록 더 길고 멀리 나간 뒤 사라져 "쏜" 느낌을 준다. */
  private drawFireTracer(r: IRenderer): void {
    const progress = 1 - this.fireFlash / FIRE_FLASH_TICKS; // 0(막 발사) → 1(끝)
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const start = C.lineWidth + progress * 60; // 머리에서 점점 앞으로 밀려나며
    const len = 46 * (1 - progress); // 점점 짧아진다(잔상처럼 흩어짐)
    const x1 = this.x + cos * start;
    const y1 = this.y + sin * start;
    r.line(x1, y1, x1 + cos * len, y1 + sin * len, FIRE_COLOR, 3);
  }

  private drawTrail(r: IRenderer, xs: readonly number[], ys: readonly number[], color: string): void {
    for (let i = 1; i < xs.length; i++) {
      r.line(xs[i - 1]!, ys[i - 1]!, xs[i]!, ys[i]!, color, C.lineWidth);
    }
  }

  isPlayerDead(): boolean {
    return this.dead;
  }

  getPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  getScore(): number {
    return this.survivalTicks;
  }

  /** 현재 「스릴 게이지」 값(0~1). HUD·테스트용. */
  getGauge(): number {
    return this.gauge;
  }

  /** 러너가 매 스텝 가져간다. 죽으면 accrueNearMiss가 안 불려 자연히 비어 있다
   *  — 관전 중 남의 판에서 내 소리가 나지 않는다. */
  consumeSounds(): readonly string[] | null {
    if (this.sounds.size === 0) return null;
    const out = [...this.sounds];
    this.sounds.clear();
    return out;
  }

  /** 러너가 매 스텝 물어본다: 상대에게 쏠 발사가 대기 중이면 걸 수 있는 **디버프 풀**을
   *  돌려주고 플래그를 내린다(한 번만 전송). 없으면 null. 이 중 어느 하나를 뽑아 누구에게
   *  보낼지는 앱이 정한다(랜덤 선택은 결정론 밖) — 서버·러너·게임 update는 슬러그를 모른다. */
  consumePendingFire(): readonly { kind: string; durationMs: number }[] | null {
    if (!this.pendingFire) return null;
    this.pendingFire = false;
    return C.fire.debuffs;
  }

  /** 남의 발사에 맞았다. 아는 조작계 디버프면 지속시간(ms)만큼 로컬에 건다 — invert(좌우
   *  반전)·sluggish(회전 둔화). 시각계(blur·shake·cloud)는 앱이 화면에 처리하므로 게임은
   *  무시한다(모르는 kind도 무시 → 효과가 늘어도 옛 클라가 안 죽는다). 이미 죽었으면 무시.
   *  결정론 안전: 내 입력/회전만 바꿀 뿐 공통 월드는 안 건드린다. */
  applyEffect(kind: string, durationMs: number): void {
    if (this.dead) return;
    const ticks = Math.round((durationMs / 1000) * TICKS_PER_SECOND);
    if (kind === "invert") this.invertTicks = Math.max(this.invertTicks, ticks);
    else if (kind === "sluggish") this.sluggishTicks = Math.max(this.sluggishTicks, ticks);
  }

  /** 관전용: 남들의 10Hz 위치를 이어 붙여 꼬리를 재구성한다. 매 스냅샷마다
   *  피어당 점 하나가 들어오므로, 직전 점과 다르면 이어 붙인다(중복 방지 —
   *  사망 통지 등 위치 변화 없이 다시 불릴 수 있다). 목록에서 빠진 피어(사망·이탈)의
   *  꼬리는 지우지 않고 그대로 남긴다 = 그 자리에 멈춘 선(다음 라운드 init에서 비움). */
  syncPeers(peers: readonly PeerState[]): void {
    for (const p of peers) {
      let trail = this.peerTrails.get(p.id);
      if (!trail) {
        trail = { xs: [], ys: [], color: PEER_COLORS[this.peerTrails.size % PEER_COLORS.length]!, label: p.label ?? "" };
        this.peerTrails.set(p.id, trail);
      } else if (p.label) {
        trail.label = p.label;
      }
      const n = trail.xs.length;
      if (n === 0 || trail.xs[n - 1] !== p.x || trail.ys[n - 1] !== p.y) {
        trail.xs.push(p.x);
        trail.ys.push(p.y);
      }
    }
  }

  renderSpectator(r: IRenderer, target: SpectateTarget): void {
    this.drawArena(r); // 장애물은 시드 공유라 이 로컬 인스턴스 것이 방 전체와 같다.
    // 남들의 재구성된 꼬리를 모두 그린다 — 관전 화면에서 판 전체가 읽히도록.
    // 각 꼬리 머리에 닉네임을 같은 색으로 붙여 누구 선인지 알아보게 한다(범례).
    for (const trail of this.peerTrails.values()) {
      this.drawTrail(r, trail.xs, trail.ys, trail.color);
      const n = trail.xs.length;
      if (trail.label && n > 0) r.text(trail.label, trail.xs[n - 1]! + 8, trail.ys[n - 1]! - 8, trail.color, 15);
    }
    // 관전 대상의 머리를 강조. 재구성 꼬리의 끝점을 쓰되, 없으면 target 좌표 폴백.
    const focus = this.peerTrails.get(target.id);
    const hx = focus && focus.xs.length ? focus.xs[focus.xs.length - 1]! : target.x;
    const hy = focus && focus.ys.length ? focus.ys[focus.ys.length - 1]! : target.y;
    r.circle(hx, hy, C.lineWidth, HEAD_COLOR);
    r.text(`관전: ${target.label}`, 12, 28, HUD_COLOR, 22);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 이번 tick의 「니어 미스」 게이지 증가량. gap이 밴드 밖이거나 음수(충돌)면 0,
 *  경계에 붙을수록(gap→0) maxGain에 가깝고 밴드 끝(gap→band)이면 0에 가깝다. */
export function nearMissGain(gap: number, band: number, maxGain: number): number {
  if (gap <= 0 || gap > band) return 0;
  return (maxGain * (band - gap)) / band;
}
