/* ============================================================
   Room — 방 상태 (게임 내용을 모르는 순수 로직)
   ------------------------------------------------------------
   서버는 "누가 방에 있고 얼마나 버텼는가"만 안다. 화살도 판정도 모른다.

   `snapshot()` / `restore()`는 Durable Object 때문에 있다. 하이버네이션되면
   메모리 필드가 날아가므로 방 상태를 ctx.storage에 넣었다 되살려야 하는데,
   클래스 인스턴스는 저장할 수 없어 평범한 객체로 오가는 통로가 필요하다.
   이 왕복이 깨지면 깨어난 방이 빈손이 되어 참가자가 통째로 사라진다.
   ============================================================ */

import type { PeerSnapshot, PlayerPublic, RoomState } from "@arcade/shared";
import { FIXED_STEP_MS } from "@arcade/shared";

/** 방 정원. 기존 RoomManager에 있던 상수를 여기로 옮겼다(RoomManager는 DO가 대체). */
export const ROOM_CAPACITY = 32;

export type Member = {
  id: string;
  nickname: string;
  alive: boolean;
  survivalTicks: number;
  connected: boolean;
  px: number;
  py: number;
  hasPosition: boolean;
  /** 이 사람이 마지막으로 알려온 기록(getScore). 살아 있는 동안 계속 덮어쓴다.
   *  ⚠️ 서버는 이 값이 tick인지 점수인지 **모른다.** 아는 것은 하나뿐이다 —
   *     연결이 끊겼을 때 최종 기록으로 쓸 값이 여기 있다는 것. */
  lastScore: number;
  /** 다음 스냅샷에 한 번 실어 보낼 게임 정의 이벤트 슬러그. 보내고 나면 지운다.
   *  서버는 의미를 모른다 — 위치와 같은 관전용 근사 정보라 저장도 하지 않는다. */
  pendingEvent?: string;
};

export type DisconnectResult = { hostChanged: string | null; died: boolean };

/** 스토리지에 저장되는 방 전체 상태. 클래스가 아니라 순수 데이터. */
export type RoomSnapshot = {
  code: string;
  gameId: string;
  state: RoomState;
  seed: number | null;
  startTime: number | null;
  emptySince: number | null;
  members: Member[];
};

/** 게임 내용을 모르는 방 상태. 연결 목록과 현재 라운드 참가 기록을 함께 보존한다. */
export class Room {
  private members: Member[] = [];
  state: RoomState = "waiting";
  seed: number | null = null;
  startTime: number | null = null;

  /** 방이 빈 채로 남아있기 시작한 시각(ms). 누군가 있으면 null.
   *
   *  ⚠️ 이게 없으면 호스트 연결이 1초만 끊겨도 방이 즉시 증발한다. 새로고침 한 번,
   *  Wi-Fi 딸꾹질 한 번에 친구가 받은 코드가 무효가 된다. 방을 만들고 코드를 전달하는
   *  몇 분 동안 아무 사고도 없어야 한다는 뜻이라 너무 취약했다.
   *  빈 방을 잠시 살려두면 그 사이 돌아온 사람이 다시 호스트가 되어 방이 이어진다. */
  emptySince: number | null = null;

  constructor(
    public readonly code: string,
    public readonly gameId: string,
    public readonly capacity: number,
  ) {}

  /** 스토리지에서 읽은 평범한 객체를 다시 Room으로. (하이버네이션 복원 경로) */
  static restore(snapshot: RoomSnapshot, capacity: number): Room {
    const room = new Room(snapshot.code, snapshot.gameId, capacity);
    room.members = snapshot.members.map((member) => ({ ...member }));
    room.state = snapshot.state;
    room.seed = snapshot.seed;
    room.startTime = snapshot.startTime;
    room.emptySince = snapshot.emptySince;
    return room;
  }

  /** 스토리지에 넣을 수 있는 평범한 객체로. */
  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      gameId: this.gameId,
      state: this.state,
      seed: this.seed,
      startTime: this.startTime,
      emptySince: this.emptySince,
      members: this.members.map((member) => ({ ...member })),
    };
  }

  get hostId(): string | null {
    return this.members.find((member) => member.connected)?.id ?? null;
  }

  get connectedCount(): number {
    return this.members.reduce((count, member) => count + (member.connected ? 1 : 0), 0);
  }

  hasConnectedMember(id: string): boolean {
    return this.members.some((member) => member.id === id && member.connected);
  }

  addMember(id: string, nickname: string): boolean {
    if (this.state !== "waiting" || this.connectedCount >= this.capacity || this.hasConnectedMember(id)) return false;
    this.members.push({ id, nickname, alive: true, survivalTicks: 0, connected: true, px: 0, py: 0, hasPosition: false, lastScore: 0 });
    this.emptySince = null; // 사람이 들어왔다 → 유예 시계를 끈다.
    return true;
  }

  /** 방이 비었음을 표시하고 유예 시계를 켠다.
   *  라운드 중이었더라도 대기 상태로 되돌린다 — 아무도 없는 라운드를 이어갈 이유가 없고,
   *  이렇게 해야 돌아온 사람이 같은 코드로 다시 들어와 새 판을 시작할 수 있다. */
  markEmpty(now: number): void {
    this.emptySince = now;
    if (this.state !== "waiting") this.returnToWaiting();
  }

  /** 유예가 끝나 회수해도 되는 빈 방인가. */
  isExpired(now: number, graceMs: number): boolean {
    return this.emptySince !== null && now - this.emptySince >= graceMs;
  }

  startCountdown(seed: number, startTime: number): void {
    this.members = this.members.filter((member) => member.connected);
    this.seed = seed;
    this.startTime = startTime;
    this.state = "countdown";
    for (const member of this.members) {
      member.alive = true;
      member.survivalTicks = 0;
      member.px = 0;
      member.py = 0;
      member.hasPosition = false;
      member.lastScore = 0;
    }
  }

  ensurePlaying(now: number): boolean {
    if (this.state === "countdown" && this.startTime !== null && now >= this.startTime) this.state = "playing";
    return this.state === "playing";
  }

  elapsedTicks(now: number): number {
    if (this.startTime === null) return 0;
    return Math.max(0, Math.floor((now - this.startTime) / FIXED_STEP_MS));
  }

  updatePosition(id: string, px: number, py: number, ev?: string, sc?: number): boolean {
    const member = this.members.find((candidate) => candidate.id === id && candidate.connected && candidate.alive);
    if (!member) return false;
    member.px = px;
    member.py = py;
    member.hasPosition = true;
    if (sc !== undefined) member.lastScore = sc;
    // ⚠️ 덮어쓰지 않는다 — 아직 못 내보낸 이벤트가 있으면 그게 우선(스냅샷은 10Hz라
    //    보내기 전에 다음 위치가 먼저 들어올 수 있다).
    if (ev !== undefined && member.pendingEvent === undefined) member.pendingEvent = ev;
    return true;
  }

  markDied(id: string, survivalTicks: number): boolean {
    const member = this.members.find((candidate) => candidate.id === id);
    if (!member || !member.alive) return false;
    member.alive = false;
    member.survivalTicks = survivalTicks;
    return true;
  }

  disconnectMember(id: string, now: number): DisconnectResult {
    const beforeHost = this.hostId;
    const member = this.members.find((candidate) => candidate.id === id && candidate.connected);
    if (!member) return { hostChanged: null, died: false };

    let died = false;
    if (this.state === "countdown" || this.state === "playing") {
      this.ensurePlaying(now);
      if (member.alive) {
        member.alive = false;
        // ⚠️ 예전에는 여기서 `elapsedTicks(now)`를 썼다. 서버가 유일하게 **값을 지어내는**
        //    자리였고, 그 값은 언제나 tick이었다 — 앞의 세 게임은 생존 tick이 곧 기록이라
        //    맞았지만, 숫자 야구처럼 기록이 점수인 게임에서는 "80초"가 "4826점"으로 찍혔다.
        //    이제는 그 사람이 마지막으로 알려온 기록을 그대로 쓴다. 서버는 여전히 그게
        //    무엇인지 모르고, 다만 **지어내지 않는다.**
        //    덤: 회피 게임에서도 이쪽이 정확하다. 끊긴 걸 서버가 알아채는 시각은 실제로
        //    끊긴 시각보다 늦을 수 있어(하이버네이션·타임아웃), 흐른 시간은 늘 부풀려졌다.
        member.survivalTicks = this.state === "playing" ? member.lastScore : 0;
        died = true;
      }
      member.connected = false;
    } else {
      this.members = this.members.filter((candidate) => candidate.id !== id);
    }

    const afterHost = this.hostId;
    return { hostChanged: beforeHost !== afterHost ? afterHost : null, died };
  }

  finish(): void {
    this.state = "finished";
  }

  returnToWaiting(): void {
    this.members = this.members.filter((member) => member.connected);
    this.state = "waiting";
    this.seed = null;
    this.startTime = null;
    for (const member of this.members) {
      member.alive = true;
      member.survivalTicks = 0;
      member.px = 0;
      member.py = 0;
      member.hasPosition = false;
      member.lastScore = 0;
    }
  }

  getConnectedMembers(): readonly Member[] {
    return this.members.filter((member) => member.connected);
  }

  getRankingMembers(): readonly Member[] {
    return this.members;
  }

  getPublicPlayers(): PlayerPublic[] {
    return this.getConnectedMembers().map((member) => ({
      id: member.id,
      nickname: member.nickname,
      alive: member.alive,
      survivalTicks: member.survivalTicks,
    }));
  }

  /** ⚠️ 부수효과 있음: 실어 보낸 이벤트는 여기서 지운다(한 번만 전달된다). */
  getPeerSnapshot(): PeerSnapshot[] {
    return this.members
      .filter((member) => member.connected && member.alive && member.hasPosition)
      .map((member) => {
        const snapshot: PeerSnapshot = { id: member.id, px: member.px, py: member.py };
        if (member.pendingEvent !== undefined) {
          snapshot.ev = member.pendingEvent;
          member.pendingEvent = undefined;
        }
        return snapshot;
      });
  }

  isEmpty(): boolean {
    return this.connectedCount === 0;
  }
}
