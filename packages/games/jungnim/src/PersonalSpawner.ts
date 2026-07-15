/* ============================================================
   PersonalSpawner — 개인(플레이어 조준) 화살 레이어
   ------------------------------------------------------------
   공통(ArrowSpawner)과 나란히 존재하지만 성격이 정반대다:
   "나를 노리는" 화살을 만든다. 조준 각도가 내 위치에 따라 달라지므로
   화살 궤적은 플레이어마다 다르다.

   ⚠️ 결정론 격리 & 관전 근사:
   - 공통과 **완전히 분리된 자체 SeededRNG**를 소유한다(공통 rng를 절대 안
     건드림 → 공통 스트림 desync 방지).
   - 모든 값이 (개인 시드 + tick + 플레이어 위치)에서만 나온다. Math.random
     없음 → 관전자는 10Hz 위치를 보간해 같은 패턴을 시각적으로 근사한다.

   패턴(페이즈 단위로 교체):
   - aimed  : 가장자리 무작위 점에서 플레이어를 향해 한 발
   - spinner: 매 발사마다 각도를 돌려, 가장자리에서 플레이어를 향해 한 발씩(회전)
   - ring   : 사방 여러 방향에서 동시에 플레이어로 조여듦
   ============================================================ */

import type { SeededRNG } from "@arcade/core";
import type { JungnimConfig } from "./config";
import type { ArrowPool } from "./ArrowPool";

type PersonalKind = "aimed" | "spinner" | "ring";

const DEG = Math.PI / 180;

export class PersonalSpawner {
  private nextSpawnTick = 0;
  /** 스피너 회전 누적각. 발사마다 stepDeg씩 증가(페이즈를 넘어도 이어짐). */
  private spinAngle = 0;
  /** 현재 페이즈에 남은 발사 수. 0이 되면 패턴을 다시 고른다. */
  private phaseRemaining = 0;
  private currentKind: PersonalKind = "aimed";

  constructor(
    private readonly rng: SeededRNG,
    private readonly cfg: JungnimConfig,
  ) {}

  /** 매 고정 스텝 호출. 플레이어 현재 위치(px,py)를 향해 개인 화살을 쏜다. */
  update(tick: number, pool: ArrowPool, px: number, py: number): void {
    const p = this.cfg.personal;
    if (tick < p.unlockTick) return; // 초반 유예.
    if (tick < this.nextSpawnTick) return;

    if (this.phaseRemaining <= 0) {
      this.currentKind = this.pickKind(tick);
      this.phaseRemaining = p.phaseSpawns;
    }
    this.fire(this.currentKind, pool, px, py);
    this.phaseRemaining--;

    this.nextSpawnTick = tick + p.intervalTicks;
  }


  /** tick 문턱으로 열린 개인 패턴 중 하나를 개인 rng로 고른다. */
  private pickKind(tick: number): PersonalKind {
    const u = this.cfg.personal.unlock;
    const avail: PersonalKind[] = ["aimed"];
    if (tick >= u.spinner) avail.push("spinner");
    if (tick >= u.ring) avail.push("ring");
    return this.rng.pick(avail);
  }

  private fire(kind: PersonalKind, pool: ArrowPool, px: number, py: number): void {
    switch (kind) {
      case "aimed":
        this.aimed(pool, px, py);
        break;
      case "spinner":
        this.spinner(pool, px, py);
        break;
      case "ring":
        this.ring(pool, px, py);
        break;
    }
  }

  // ---- 패턴들 (모두 플레이어를 향해 안쪽으로) --------------------------

  /** 둘레 무작위 점에서 플레이어를 향해 한 발. */
  private aimed(pool: ArrowPool, px: number, py: number): void {
    const [sx, sy] = this.rimPoint();
    this.emit(pool, sx, sy, Math.atan2(py - sy, px - sx));
  }

  /** 회전 스피너: 현재 회전각 방향의 둘레에서 플레이어를 향해 한 발. */
  private spinner(pool: ArrowPool, px: number, py: number): void {
    const [sx, sy] = this.rimExitPoint(px, py, this.spinAngle);
    this.emit(pool, sx, sy, this.spinAngle + Math.PI); // 둘레→플레이어(안쪽).
    this.spinAngle += this.cfg.personal.spinner.stepDeg * DEG;
  }

  /** 링: 플레이어를 중심으로 사방 count방향의 둘레에서 동시에 조여든다. */
  private ring(pool: ArrowPool, px: number, py: number): void {
    const { count } = this.cfg.personal.ring;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const [sx, sy] = this.rimExitPoint(px, py, ang);
      this.emit(pool, sx, sy, ang + Math.PI);
    }
  }

  // ---- 기하 헬퍼 ------------------------------------------------------

  /** (px,py)에서 angle 방향으로 나아갈 때 경기장 원과 만나는 둘레 점(전방 교점).
   *  플레이어는 원 안에 있으므로 어느 방향이든 전방으로 딱 하나 만난다.
   *  개인 화살이 원 밖이 아니라 "둘레"에서 출발하게 해 즉시 컬링을 피한다.
   *  ⚠️ rng를 소비하지 않는다 — 위치에만 의존(관전 재구성 불변식). */
  private rimExitPoint(px: number, py: number, angle: number): [number, number] {
    const { cx, cy, radius } = this.cfg.arena;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const fx = px - cx;
    const fy = py - cy;
    // |f + t·d|² = R² 의 전방 해. b=f·d, c=|f|²-R². 플레이어가 안이면 c<0 → 전방 해 존재.
    const b = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - radius * radius;
    const t = -b + Math.sqrt(Math.max(0, b * b - c));
    return [px + dx * t, py + dy * t];
  }

  /** 경기장 둘레 위의 무작위 점(개인 rng). ⚠️ rng 소비는 위치와 무관(재구성 불변식). */
  private rimPoint(): [number, number] {
    const { cx, cy, radius } = this.cfg.arena;
    const theta = this.rng.next() * Math.PI * 2;
    return [cx + Math.cos(theta) * radius, cy + Math.sin(theta) * radius];
  }

  /** 풀에서 화살을 꺼내 개인 화살로 표시하고 발사. */
  private emit(pool: ArrowPool, x: number, y: number, angle: number): void {
    const a = pool.acquire();
    if (a === undefined) return; // 풀 고갈.
    const v = this.cfg.personal.speed;
    a.x = x;
    a.y = y;
    a.vx = Math.cos(angle) * v;
    a.vy = Math.sin(angle) * v;
    a.personal = true; // 렌더 색 구분 + 레이어 식별.
  }
}
