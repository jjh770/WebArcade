/* ============================================================
   ArrowSpawner — 화살 스폰 (결정론 불변식의 핵심 소비자)
   ------------------------------------------------------------
   "언제/어디서/어느 방향으로" 화살이 나오는지를 결정한다. 이 결정이
   클라이언트마다 같아야 모두가 같은 화살 패턴을 겪는다.

   원형 경기장: 화살은 원 둘레의 한 점에서 출발해 안쪽(중심 방향)으로 날아온다.
   둘레 위치는 각도 θ 하나로 표현한다 — 사각형 4개 변보다 오히려 단순하다.

   ⚠️ 불변식:
   - "언제": tick의 함수. difficulty = floor(tick / rampTicks)로 스폰 간격이
     좁아지고 난이도가 높을수록 더 매운 패턴이 열린다. Date.now() 금지.
   - "어디서/어느 방향": 시드로 초기화된 SeededRNG에서만 뽑는다.
   - ❗ 어떤 패턴도 플레이어 위치를 참조하지 않는다. 조준(converge)조차
     "경기장 중심 ± 시드 지터"를 노린다. 플레이어를 조준하면 클라마다 화살이
     달라져 동기화가 깨진다. (AGENTS.md: "이 값이 시드/tick에서 나왔나?")
   ============================================================ */

import type { SeededRNG } from "@arcade/core";
import type { JungnimConfig } from "./config";
import type { ArrowPool } from "./ArrowPool";

type PatternKind = "single" | "spread" | "wall" | "converge";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export class ArrowSpawner {
  /** 다음 스폰이 허용되는 tick. tick이 여기 도달하면 한 패턴을 쏜다. */
  private nextSpawnTick = 0;

  constructor(
    private readonly rng: SeededRNG,
    private readonly cfg: JungnimConfig,
  ) {}

  /** 매 고정 스텝 호출. 스폰 시점이면 난이도에 맞는 패턴 하나를 쏜다. */
  update(tick: number, pool: ArrowPool): void {
    if (tick < this.nextSpawnTick) return;

    const difficulty = Math.floor(tick / this.cfg.spawn.rampTicks);
    this.fire(this.pickPattern(difficulty), pool);

    // 난이도가 오를수록 간격이 좁아지되 최소값 아래로는 안 내려간다.
    const interval = Math.max(
      this.cfg.spawn.minIntervalTicks,
      this.cfg.spawn.baseIntervalTicks - difficulty,
    );
    this.nextSpawnTick = tick + interval;
  }

  /** 난이도에 따라 열린 패턴 후보 중 하나를 시드로 고른다. */
  private pickPattern(difficulty: number): PatternKind {
    const { unlock } = this.cfg.pattern;
    const avail: PatternKind[] = ["single"];
    if (difficulty >= unlock.spread) avail.push("spread");
    if (difficulty >= unlock.wall) avail.push("wall");
    if (difficulty >= unlock.converge) avail.push("converge");
    return this.rng.pick(avail);
  }

  private fire(kind: PatternKind, pool: ArrowPool): void {
    switch (kind) {
      case "single":
        this.single(pool);
        break;
      case "spread":
        this.spread(pool);
        break;
      case "wall":
        this.wall(pool);
        break;
      case "converge":
        this.converge(pool);
        break;
    }
  }

  // ---- 패턴들 (모두 시드/tick만 소비) ---------------------------------

  /** 한 발. 둘레 무작위 지점에서 안으로, 약간의 각도 흔들림. */
  private single(pool: ArrowPool): void {
    const theta = this.rng.next() * TAU;
    const [x, y] = this.rimPoint(theta);
    const j = this.cfg.pattern.angleJitterDeg * DEG;
    this.emit(pool, x, y, this.inwardAngle(theta) + this.rng.range(-j, j));
  }

  /** 부채꼴. 둘레 한 지점에서 여러 발을 각도 범위 안에 펼친다(중심 방향 기준). */
  private spread(pool: ArrowPool): void {
    const theta = this.rng.next() * TAU;
    const [x, y] = this.rimPoint(theta);
    const { count, totalDeg } = this.cfg.pattern.spread;
    const total = totalDeg * DEG;
    const step = count > 1 ? total / (count - 1) : 0;
    const start = this.inwardAngle(theta) - total / 2;
    for (let i = 0; i < count; i++) this.emit(pool, x, y, start + step * i);
  }

  /** 벽. 둘레의 한 호(arc)를 촘촘히 채우되 gap칸을 비워 안전 통로를 남긴다.
   *  각 화살은 자기 둘레점에서 중심 방향으로 — 원호가 안으로 조여드는 모양. */
  private wall(pool: ArrowPool): void {
    const { count, gap } = this.cfg.pattern.wall;
    const arc = this.cfg.pattern.wallArcDeg * DEG;
    const startTheta = this.rng.next() * TAU; // 호의 시작 각도.
    const step = count > 1 ? arc / (count - 1) : 0;
    const gapStart = this.rng.int(Math.max(1, count - gap + 1));
    for (let i = 0; i < count; i++) {
      if (i >= gapStart && i < gapStart + gap) continue; // 안전 지대
      const theta = startTheta + step * i;
      const [x, y] = this.rimPoint(theta);
      this.emit(pool, x, y, this.inwardAngle(theta));
    }
  }

  /** 수렴. 경기장 중심 ± 시드 지터 지점을 향해 둘레 사방에서 조인다(플레이어 아님). */
  private converge(pool: ArrowPool): void {
    const { cx, cy } = this.cfg.arena;
    const { count, aimJitterPx: j } = this.cfg.pattern.converge;
    const tx = cx + this.rng.range(-j, j);
    const ty = cy + this.rng.range(-j, j);
    for (let i = 0; i < count; i++) {
      const [x, y] = this.rimPoint(this.rng.next() * TAU);
      this.emit(pool, x, y, Math.atan2(ty - y, tx - x));
    }
  }

  // ---- 기하 헬퍼 ------------------------------------------------------

  /** 경기장 둘레 위의 점. 각도 θ(라디안). */
  private rimPoint(theta: number): [number, number] {
    const { cx, cy, radius } = this.cfg.arena;
    return [cx + Math.cos(theta) * radius, cy + Math.sin(theta) * radius];
  }

  /** 둘레점 θ에서 중심을 향하는 각도. 둘레점의 방위각 반대쪽. */
  private inwardAngle(theta: number): number {
    return theta + Math.PI;
  }

  /** 풀에서 화살 하나를 꺼내 (x,y)에서 angle 방향, 고정 속도로 발사. */
  private emit(pool: ArrowPool, x: number, y: number, angle: number): void {
    const a = pool.acquire();
    if (a === undefined) return; // 풀 고갈 — 이 화살은 건너뛴다.
    const v = this.cfg.arrowSpeed;
    a.x = x;
    a.y = y;
    a.vx = Math.cos(angle) * v;
    a.vy = Math.sin(angle) * v;
  }
}
