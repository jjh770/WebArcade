/* ============================================================
   FloorGame — 무너지는 바닥. IGame 구현. (세 번째 게임)
   ------------------------------------------------------------
   이 클래스는 games/ 안에만 존재한다. core는 이걸 모른다.

   앞의 두 게임과 다른 점 두 가지가 이 게임의 존재 이유다.

   1) **칸 단위 이동.** InputState는 「누르고 있다」만 준다. 「누른 순간」은
      이전 tick의 입력을 게임이 직접 들고 있다가 비교해 만든다(edge detection).
      계약을 넓히지 않고 게임 안에서 풀린다 — 눌린 순간 한 칸, 계속 누르고
      있으면 유예 뒤 자동 반복.

   2) **공통 월드가 지형이다.** 죽림고수는 날아오는 화살, 커브는 깔린 장애물이었다면
      여기서는 바닥 자체가 시드+tick 일정으로 뚫렸다 메워진다.

   결정론 불변식: 어느 칸이 무너질지는 **오직 시드와 tick**에서 나온다.
   ⚠️ 플레이어 위치를 절대 보지 않는다 — 보는 순간 클라마다 판이 갈린다.
   ============================================================ */

import type { IGame, IRenderer, InputState, SpectateSignal, SpectateTarget, PeerState, SpawnContext } from "@arcade/shared";
import { formatTicks } from "@arcade/shared";
import { SeededRNG } from "@arcade/shared";
import { floorConfig as C } from "./config";

const BACKDROP = "#15171d"; // 격자 바깥 + 뚫린 칸(= 아래가 비쳐 보인다)
const TILE = "#f1faee"; // 멀쩡한 바닥
const TILE_EDGE = "#cfd8d3"; // 바닥 아래쪽 그림자 — 두께가 있어 보이게
const WARN = "#ffd166"; // 금이 간 칸(곧 뚫린다)
const WARN_DEEP = "#f77f00"; // 깜빡임의 반대 위상 — 뚫리기 직전일수록 자주 번갈아
const ME = "#e63946";
/** ME와 같은 색의 RGB 성분. 잔상·파문을 반투명으로 깔 때 쓴다
 *  (IRenderer는 색 문자열을 그대로 받으므로 rgba()가 통한다 — 계약을 안 넓혀도 된다). */
const ME_RGB = "230,57,70";
const HUD = "#e8eef2";
/** 관전 대상(남) 표시색. 커브 피버와 같은 팔레트라 사이드 화면에서 결이 맞는다. */
const PEER_COLORS = ["#f4a261", "#2a9d8f", "#e9c46a", "#a8dadc", "#c77dff", "#90be6d"];

const CELLS = C.cols * C.rows;
/** 칸 하나가 차지하는 정사각형 크기(px, 틈 포함). */
const CELL = (C.screenWidth - C.margin * 2) / C.cols;

type Dir = "up" | "down" | "left" | "right";
const DIRS: readonly Dir[] = ["up", "down", "left", "right"];
const STEP: Record<Dir, { dc: number; dr: number }> = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
};

/** 칸의 현재 상태. 렌더와 판정이 같은 함수를 쓴다 — 보이는 것과 죽는 것이 어긋나면 안 된다. */
type TileState = "solid" | "warn" | "hole";

export class FloorGame implements IGame {
  private rng!: SeededRNG;
  /** 칸별 일정(절대 tick). -1이면 아무 일정 없음(멀쩡함).
   *  ⚠️ 예고 시간은 난이도에 따라 줄어든다. 그래서 "지금 tick에서 계산"하지 않고
   *  금이 갈 때 확정한 절대 시각을 들고 있는다 — 안 그러면 예고 중에 규칙이 바뀐다. */
  private holeAt!: Int32Array; // 이 tick부터 뚫린다
  private solidAt!: Int32Array; // 이 tick부터 다시 메워진다
  private cracked!: Uint8Array; // 일정이 잡혀 있는가

  private col = 0;
  private row = 0;
  private survivalTicks = 0;
  private worldTick = 0;
  private dead = false;

  /** 이전 tick의 입력. 「누른 순간」을 만들려고 들고 있는다. */
  private prev: InputState = { up: false, down: false, left: false, right: false };

  /* 이동 연출용(순수 렌더). 논리 위치는 누른 즉시 새 칸이고, 아래 셋은 화면이
     그 칸까지 미끄러져 가는 동안의 출발점과 시각이다. */
  private fromCol = 0;
  private fromRow = 0;
  private movedAt = -999;

  /** 이번 스텝에 낼 소리. Set이라 어휘 수만큼만 커진다 — 아무도 안 가져가도 안 쌓인다. */
  private readonly sounds = new Set<string>();

  /** 관전 대상(남)들의 현재 위치. 격자 좌표가 아니라 게임 좌표(px)로 받는다. */
  private readonly peers = new Map<string, { x: number; y: number }>();
  private peerOrder: string[] = [];

  init(seed: number, self?: SpawnContext): void {
    this.rng = new SeededRNG(seed);
    this.holeAt = new Int32Array(CELLS);
    this.solidAt = new Int32Array(CELLS);
    this.cracked = new Uint8Array(CELLS);
    const spawn = this.pickSpawn(self);
    this.col = spawn.col;
    this.row = spawn.row;
    this.fromCol = spawn.col;
    this.fromRow = spawn.row;
    this.movedAt = -999; // 시작부터 미끄러져 들어오지 않게 충분히 과거로
    this.survivalTicks = 0;
    this.worldTick = 0;
    this.dead = false;
    this.prev = { up: false, down: false, left: false, right: false };
    this.sounds.clear();
    this.peers.clear();
    this.peerOrder = [];
  }

  /** 멀티면 인원수만큼 서로 떨어진 시작 칸을 나눠 갖는다(전원이 같은 집합을 계산).
   *  솔로면 한가운데. ⚠️ RNG를 쓰지 않는다 — 스폰이 붕괴 일정을 밀면 안 된다. */
  private pickSpawn(self?: SpawnContext): { col: number; row: number } {
    const centerC = Math.floor(C.cols / 2);
    const centerR = Math.floor(C.rows / 2);
    if (!self || self.count <= 1) return { col: centerC, row: centerR };
    // 중앙을 둘러싼 원 위에 인원수만큼 고르게 배치한다.
    const radius = Math.max(2, Math.floor(Math.min(C.cols, C.rows) / 3));
    const angle = (self.index / self.count) * Math.PI * 2;
    return {
      col: clampInt(centerC + Math.round(Math.cos(angle) * radius), 0, C.cols - 1),
      row: clampInt(centerR + Math.round(Math.sin(angle) * radius), 0, C.rows - 1),
    };
  }

  update(tick: number, input: InputState): void {
    this.worldTick = tick;

    // ⚠️ 공통 월드는 사망과 무관하게 항상 전진한다(관전 배경 + 남들과 안 어긋나게).
    this.scheduleWaves(tick);
    // 이번 tick에 실제로 뚫린 칸이 있으면 부서지는 소리 하나. 몇 칸이 한꺼번에
    // 무너지든 한 번만 — 러너가 프레임 단위로 합치고, 겹쳐 봐야 커지기만 한다.
    for (let cell = 0; cell < CELLS; cell++) {
      if (this.cracked[cell] && this.holeAt[cell] === tick) {
        this.sounds.add("crack");
        break;
      }
    }

    if (!this.dead) {
      this.moveByInput(tick, input);
      // 발밑이 뚫렸으면 죽는다. 서 있다 꺼진 경우와 뚫린 칸으로 걸어 들어간 경우가
      // 같은 판정으로 처리된다 — 둘 다 "지금 내 칸이 구멍인가"다.
      if (this.tileState(this.index(this.col, this.row), tick) === "hole") this.dead = true;
      this.survivalTicks = tick; // 사망 프레임까지 포함 → 생존시간 = 사망 tick
    }
    this.prev = { up: input.up, down: input.down, left: input.left, right: input.right };
  }

  /* ---- 이동: 「누른 순간」을 게임이 만든다 -------------------------------- */

  /** ⚠️ **자동 반복은 없다.** 이번 tick에 **새로 눌린** 방향에만 반응한다 —
   *  꾹 누르고 있으면 첫 한 칸 뒤로는 아무 일도 없고, 한 칸 더 가려면 떼었다
   *  다시 눌러야 한다. 몇 칸 갈지를 손가락이 정하게 하려는 것이다. */
  private moveByInput(tick: number, input: InputState): void {
    for (const dir of DIRS) {
      if (input[dir] && !this.prev[dir]) {
        this.step(dir, tick);
        return; // 같은 tick에 둘이 눌려도 한 칸만 — 격자 이동은 한 번에 하나다
      }
    }
  }

  /** 한 칸 이동. 격자 밖으로는 나가지 않는다(벽에 막힐 뿐 죽지는 않는다).
   *  논리 위치는 **여기서 즉시** 바뀐다. 화면이 미끄러지는 건 렌더의 몫이다. */
  private step(dir: Dir, tick: number): void {
    const { dc, dr } = STEP[dir];
    const col = clampInt(this.col + dc, 0, C.cols - 1);
    const row = clampInt(this.row + dr, 0, C.rows - 1);
    if (col === this.col && row === this.row) return; // 벽에 막혔다 — 연출도 없다
    this.fromCol = this.col;
    this.fromRow = this.row;
    this.movedAt = tick;
    this.col = col;
    this.row = row;
  }

  /* ---- 붕괴 일정: 시드 + tick만 ------------------------------------------ */

  private scheduleWaves(tick: number): void {
    if (tick < C.unlockTick) return;
    if ((tick - C.unlockTick) % C.waveIntervalTicks !== 0) return;

    const grown = C.waveCells + Math.floor(tick / C.waveGrowthTicks);
    const count = Math.min(grown, C.maxWaveCells);
    const warn = Math.max(C.minWarnTicks, C.warnTicks - Math.floor(tick / C.warnShrinkTicks));

    for (let picked = 0; picked < count; picked++) {
      // ⚠️ 이미 일정이 잡힌 칸을 뽑아도 **rng는 그대로 한 번 소비한다.**
      // 재시도로 소비 횟수를 바꾸면 클라마다 스트림이 어긋난다.
      const cell = Math.floor(this.rng.next() * CELLS);
      if (this.cracked[cell]) continue;
      this.cracked[cell] = 1;
      this.holeAt[cell] = tick + warn;
      this.solidAt[cell] = tick + warn + C.holeTicks;
    }
  }

  /** 칸 상태. 다 메워졌으면 일정을 지워 다음 물결이 다시 고를 수 있게 한다. */
  private tileState(cell: number, tick: number): TileState {
    if (!this.cracked[cell]) return "solid";
    if (tick < this.holeAt[cell]) return "warn";
    if (tick < this.solidAt[cell]) return "hole";
    this.cracked[cell] = 0; // 지연 정리 — 상태를 물을 때 치운다
    return "solid";
  }

  private index(col: number, row: number): number {
    return row * C.cols + col;
  }

  /* ---- 렌더 -------------------------------------------------------------- */

  /** ⚠️ 생존 시간을 여기서 그리지 않는다 — 캔버스 밖 DOM HUD(#hud-time)가 이미
   *  같은 자리에 같은 값을 띄운다. 앞의 두 게임도 죽는 순간에만 시간을 적는다. */
  render(r: IRenderer, alpha: number): void {
    this.drawFloor(r, alpha);
    if (!this.dead) {
      this.drawMe(r, this.worldTick + alpha); // alpha까지 더해 프레임 사이도 매끄럽게
      return;
    }
    const cx = C.screenWidth / 2;
    const cy = C.screenHeight / 2;
    r.text(`떨어졌다 — 생존 ${formatTicks(this.survivalTicks)}`, cx - 130, cy, ME, 26);
  }

  /** 내 말. 칸에서 칸으로 곧게 미끄러지되 **꼬리를 끌고** 간다 — 위아래로 뛰지도
   *  않고 착지 연출도 없으므로, 속도감은 오로지 잔상이 만든다.
   *  ⚠️ 전부 렌더 전용이다. 판정은 이 값을 절대 안 본다. */
  private drawMe(r: IRenderer, at: number): void {
    const base = (CELL - C.gap) * 0.3;
    const t = (at - this.movedAt) / C.moveTicks;

    // 꼬리 — 뒤로 갈수록 고르게 옅어지고 작아진다. 먼 것부터 그려야 가까운 잔상이 위에 온다.
    if (t > 0 && t < 1) {
      for (let ghost = C.ghosts; ghost >= 1; ghost--) {
        const gt = t - ghost * C.ghostGap;
        if (gt <= 0) continue;
        const fade = 1 - ghost / (C.ghosts + 1); // 1에 가까울수록 진하고 크다
        const g = this.slideAt(gt);
        r.circle(g.x, g.y, base * (0.55 + 0.35 * fade), rgba(ME_RGB, C.ghostAlpha * fade));
      }
    }

    const now = this.slideAt(t);
    r.circle(now.x, now.y, base, ME);
  }

  /** 이동 중 한 시점의 화면 위치. t는 진행도(0=출발, 1=도착). */
  private slideAt(t: number): { x: number; y: number } {
    const to = this.cellCenter(this.col, this.row);
    if (t >= 1 || t < 0) return to;
    const from = this.cellCenter(this.fromCol, this.fromRow);
    // 목표를 살짝 지나쳤다 돌아온다 — 딱 멈추는 것보다 탄력 있게 붙는다.
    const e = easeBackOut(t);
    return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
  }

  renderSpectator(r: IRenderer, target: SpectateTarget): void {
    // 관전은 남의 위치를 10Hz로 받아 그리므로 프레임 사이 보간이 없다(alpha=0).
    this.drawFloor(r, 0);
    const peer = this.peers.get(target.id);
    if (peer) {
      const color = PEER_COLORS[this.peerIndex(target.id) % PEER_COLORS.length];
      const { col, row } = this.toCell(peer.x, peer.y);
      this.drawPawn(r, col, row, color);
    }
    r.text(`관전: ${target.label}`, C.margin, C.margin - 14, HUD, 20);
  }

  private drawFloor(r: IRenderer, alpha: number): void {
    r.clear();
    r.rect(0, 0, C.screenWidth, C.screenHeight, BACKDROP);
    const tick = this.worldTick;
    const at = tick + alpha;
    for (let row = 0; row < C.rows; row++) {
      for (let col = 0; col < C.cols; col++) {
        const cell = this.index(col, row);
        const state = this.tileState(cell, tick);
        const x = C.margin + col * CELL + C.gap / 2;
        const y = C.margin + row * CELL + C.gap / 2;
        const size = CELL - C.gap;

        if (state === "hole") {
          // 막 뚫린 칸은 곧장 사라지지 않고 쪼그라들며 떨어진다 — 무너지는 순간이 보여야
          // "밟고 있었으면 죽었다"가 읽힌다. 다 떨어지면 배경만 남아 그게 구멍이다.
          const falling = (at - this.holeAt[cell]) / C.fallTicks;
          if (falling >= 0 && falling < 1) {
            const shrink = size * (1 - falling);
            const drop = falling * size * 0.5; // 아래로 꺼지며
            r.rect(x + (size - shrink) / 2, y + (size - shrink) / 2 + drop, shrink, shrink, WARN_DEEP);
          }
          continue;
        }
        if (state === "solid") {
          r.rect(x, y + size - 4, size, 4, TILE_EDGE); // 아래쪽 그림자 = 두께
          r.rect(x, y, size, size - 4, TILE);
          continue;
        }
        // 금이 간 칸: 뚫리기 직전일수록 빠르게 번갈아 깜빡인다(순수 렌더).
        const left = this.holeAt[cell] - tick;
        const period = Math.max(3, Math.min(C.warnBlinkTicks, left));
        r.rect(x, y, size, size, Math.floor(tick / period) % 2 === 0 ? WARN : WARN_DEEP);
      }
    }
  }

  private drawPawn(r: IRenderer, col: number, row: number, color: string): void {
    const { x, y } = this.cellCenter(col, row);
    r.circle(x, y, (CELL - C.gap) * 0.3, color);
  }

  private cellCenter(col: number, row: number): { x: number; y: number } {
    return { x: C.margin + col * CELL + CELL / 2, y: C.margin + row * CELL + CELL / 2 };
  }

  private toCell(x: number, y: number): { col: number; row: number } {
    return {
      col: clampInt(Math.floor((x - C.margin) / CELL), 0, C.cols - 1),
      row: clampInt(Math.floor((y - C.margin) / CELL), 0, C.rows - 1),
    };
  }

  /* ---- IGame 나머지 ------------------------------------------------------ */

  /** 러너가 매 스텝 가져간다. 죽어도 바닥은 계속 무너지므로 소리는 계속 난다
   *  — 관전 중에도 그 판의 바닥이 무너지는 소리가 들리는 게 맞다. */
  consumeSounds(): readonly string[] | null {
    if (this.sounds.size === 0) return null;
    const out = [...this.sounds];
    this.sounds.clear();
    return out;
  }

  isPlayerDead(): boolean {
    return this.dead;
  }

  /** 이 게임은 관전 신호에 좌표를 싣는다(칸이 아니라 칸의 중심점 — 받는 쪽이
   *  toCell로 다시 칸을 찾는다). */
  getPosition(): SpectateSignal {
    const { x, y } = this.cellCenter(this.col, this.row);
    return { a: x, b: y };
  }

  syncPeers(peers: readonly PeerState[]): void {
    const seen = new Set<string>();
    for (const p of peers) {
      seen.add(p.id);
      if (!this.peers.has(p.id)) this.peerOrder.push(p.id);
      this.peers.set(p.id, { x: p.a, y: p.b }); // a·b는 이 게임에서 좌표다.
    }
    for (const id of [...this.peers.keys()]) if (!seen.has(id)) this.peers.delete(id);
  }

  /** 이름표 색을 고정하기 위한 등장 순서. 매 프레임 바뀌면 색이 깜빡인다. */
  private peerIndex(id: string): number {
    const index = this.peerOrder.indexOf(id);
    return index < 0 ? 0 : index;
  }

  getScore(): number {
    return this.survivalTicks;
  }
}

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 목표를 살짝 지나쳤다 되돌아온다(back-out). 그냥 감속해 멈추는 것보다
 *  "탁 하고 붙는" 탄력이 생긴다. 1.7은 넘어가는 정도 — 키우면 더 튄다. */
function easeBackOut(t: number): number {
  const overshoot = 1.7;
  const inv = t - 1;
  return 1 + (overshoot + 1) * inv * inv * inv + overshoot * inv * inv;
}

/** 같은 색을 알파만 바꿔 쓴다. 0~1을 벗어나면 캔버스가 통째로 무시하므로 가둔다. */
function rgba(rgb: string, alpha: number): string {
  return `rgba(${rgb},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}
