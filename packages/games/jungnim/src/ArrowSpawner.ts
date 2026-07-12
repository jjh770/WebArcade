/* ============================================================
   ArrowSpawner — 화살 스폰 (결정론 불변식의 핵심 소비자)
   ------------------------------------------------------------
   "언제/어디서/어느 방향으로" 화살이 나오는지를 결정한다. 이 결정이
   클라이언트마다 같아야 모두가 같은 화살 패턴을 겪는다.

   ⚠️ 불변식:
   - "언제": tick의 함수. difficulty = floor(tick / rampTicks)로 스폰 간격이
     좁아지고 난이도가 높을수록 더 매운 패턴이 열린다. Date.now() 금지.
   - "어디서/어느 방향": 시드로 초기화된 SeededRNG에서만 뽑는다.
   - ❗ 어떤 패턴도 플레이어 위치를 참조하지 않는다. 조준(converge)조차
     "화면 중앙 ± 시드 지터"를 노린다. 플레이어를 조준하면 클라마다 화살이
     달라져 동기화가 깨진다. (AGENTS.md: "이 값이 시드/tick에서 나왔나?")
   ============================================================ */

import type { SeededRNG } from "@arcade/core";
import type { JungnimConfig } from "./config";
import type { ArrowPool } from "./ArrowPool";

/** 화살이 출발하는 변(edge). rng.int(4)로 고르는 인덱스와 대응.
 *  (const enum은 isolatedModules/esbuild와 상성이 나빠 일반 enum 사용) */
enum Edge {
  Left = 0,
  Right = 1,
  Top = 2,
  Bottom = 3,
}

type PatternKind = "single" | "spread" | "wall" | "converge";

const DEG = Math.PI / 180;

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

  /** 재시작용: 스폰 타이머 초기화. (rng 재시드는 JungnimGame.init이 담당) */
  reset(): void {
    this.nextSpawnTick = 0;
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

  /** 한 발. 무작위 변·위치에서 안으로, 약간의 각도 흔들림. */
  private single(pool: ArrowPool): void {
    const edge = this.rng.int(4) as Edge;
    const [x, y] = this.edgePoint(edge, this.rng.next());
    const j = this.cfg.pattern.angleJitterDeg * DEG;
    this.emit(pool, x, y, this.baseAngle(edge) + this.rng.range(-j, j));
  }

  /** 부채꼴. 한 지점에서 여러 발을 각도 범위 안에 펼친다. */
  private spread(pool: ArrowPool): void {
    const edge = this.rng.int(4) as Edge;
    const [x, y] = this.edgePoint(edge, this.rng.next());
    const { count, totalDeg } = this.cfg.pattern.spread;
    const total = totalDeg * DEG;
    const step = count > 1 ? total / (count - 1) : 0;
    const start = this.baseAngle(edge) - total / 2;
    for (let i = 0; i < count; i++) this.emit(pool, x, y, start + step * i);
  }

  /** 벽. 한 변을 촘촘히 채우되 gap칸을 비워 안전 통로를 남긴다. */
  private wall(pool: ArrowPool): void {
    const edge = this.rng.int(4) as Edge;
    const base = this.baseAngle(edge);
    const { count, gap } = this.cfg.pattern.wall;
    const gapStart = this.rng.int(Math.max(1, count - gap + 1));
    for (let i = 0; i < count; i++) {
      if (i >= gapStart && i < gapStart + gap) continue; // 안전 지대
      const [x, y] = this.edgePoint(edge, (i + 0.5) / count);
      this.emit(pool, x, y, base);
    }
  }

  /** 수렴. 화면 중앙 ± 시드 지터 지점을 향해 사방에서 조인다(플레이어 아님). */
  private converge(pool: ArrowPool): void {
    const { screenWidth: w, screenHeight: h } = this.cfg;
    const { count, aimJitterPx: j } = this.cfg.pattern.converge;
    const tx = w / 2 + this.rng.range(-j, j);
    const ty = h / 2 + this.rng.range(-j, j);
    for (let i = 0; i < count; i++) {
      const edge = this.rng.int(4) as Edge;
      const [x, y] = this.edgePoint(edge, this.rng.next());
      this.emit(pool, x, y, Math.atan2(ty - y, tx - x));
    }
  }

  // ---- 기하 헬퍼 ------------------------------------------------------

  /** 변 위의 점. t∈[0,1]이 변을 따라 위치를 준다. */
  private edgePoint(edge: Edge, t: number): [number, number] {
    const { screenWidth: w, screenHeight: h } = this.cfg;
    switch (edge) {
      case Edge.Left:
        return [0, t * h];
      case Edge.Right:
        return [w, t * h];
      case Edge.Top:
        return [t * w, 0];
      case Edge.Bottom:
        return [t * w, h];
    }
  }

  /** 변에서 화면 안쪽을 향하는 기본 각도(라디안, y는 아래로 증가). */
  private baseAngle(edge: Edge): number {
    switch (edge) {
      case Edge.Left:
        return 0;
      case Edge.Right:
        return Math.PI;
      case Edge.Top:
        return Math.PI / 2;
      case Edge.Bottom:
        return -Math.PI / 2;
    }
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
