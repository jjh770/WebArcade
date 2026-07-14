import type { PlayerPublic, RoomState } from "@arcade/shared";

const FIXED_STEP_MS = 1000 / 60;

export type Member = {
  id: string;
  nickname: string;
  alive: boolean;
  survivalTicks: number;
  connected: boolean;
  px: number;
  py: number;
  hasPosition: boolean;
};

export type DisconnectResult = { hostChanged: string | null; died: boolean };

/** 게임 내용을 모르는 방 상태. 연결 목록과 현재 라운드 참가 기록을 함께 보존한다. */
export class Room {
  private members: Member[] = [];
  state: RoomState = "waiting";
  seed: number | null = null;
  startTime: number | null = null;

  constructor(
    public readonly code: string,
    public readonly gameId: string,
    public readonly capacity: number,
  ) {}

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
    this.members.push({ id, nickname, alive: true, survivalTicks: 0, connected: true, px: 0, py: 0, hasPosition: false });
    return true;
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

  updatePosition(id: string, px: number, py: number): boolean {
    const member = this.members.find((candidate) => candidate.id === id && candidate.connected && candidate.alive);
    if (!member) return false;
    member.px = px;
    member.py = py;
    member.hasPosition = true;
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
        member.survivalTicks = this.state === "playing" ? this.elapsedTicks(now) : 0;
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

  getPeerSnapshot(): { id: string; px: number; py: number }[] {
    return this.members
      .filter((member) => member.connected && member.alive && member.hasPosition)
      .map((member) => ({ id: member.id, px: member.px, py: member.py }));
  }

  isEmpty(): boolean {
    return this.connectedCount === 0;
  }
}
