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

  /** 가장자리 무작위 점에서 플레이어를 향해 한 발. */
  private aimed(pool: ArrowPool, px: number, py: number): void {
    const [sx, sy] = this.perimeterPoint();
    this.emit(pool, sx, sy, Math.atan2(py - sy, px - sx));
  }

  /** 회전 스피너: 현재 회전각 방향의 가장자리에서 플레이어를 향해 한 발. */
  private spinner(pool: ArrowPool, px: number, py: number): void {
    const [sx, sy] = this.edgeExitPoint(px, py, this.spinAngle);
    this.emit(pool, sx, sy, this.spinAngle + Math.PI); // 가장자리→플레이어(안쪽).
    this.spinAngle += this.cfg.personal.spinner.stepDeg * DEG;
  }

  /** 링: 플레이어를 중심으로 사방 count방향의 가장자리에서 동시에 조여든다. */
  private ring(pool: ArrowPool, px: number, py: number): void {
    const { count } = this.cfg.personal.ring;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const [sx, sy] = this.edgeExitPoint(px, py, ang);
      this.emit(pool, sx, sy, ang + Math.PI);
    }
  }

  // ---- 기하 헬퍼 ------------------------------------------------------

  /** (px,py)에서 angle 방향으로 나아갈 때 화면 사각형과 만나는 가장자리 점.
   *  개인 화살이 화면 밖이 아니라 "가장자리"에서 출발하게 해 즉시 컬링을 피한다. */
  private edgeExitPoint(px: number, py: number, angle: number): [number, number] {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const { screenWidth: w, screenHeight: h } = this.cfg;
    let t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (w - px) / dx);
    else if (dx < -1e-9) t = Math.min(t, -px / dx);
    if (dy > 1e-9) t = Math.min(t, (h - py) / dy);
    else if (dy < -1e-9) t = Math.min(t, -py / dy);
    if (!Number.isFinite(t)) t = 0;
    return [px + dx * t, py + dy * t];
  }

  /** 화면 네 변 중 하나의 무작위 점(개인 rng). */
  private perimeterPoint(): [number, number] {
    const { screenWidth: w, screenHeight: h } = this.cfg;
    const t = this.rng.next();
    switch (this.rng.int(4)) {
      case 0:
        return [0, t * h]; // 왼쪽
      case 1:
        return [w, t * h]; // 오른쪽
      case 2:
        return [t * w, 0]; // 위
      default:
        return [t * w, h]; // 아래
    }
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
