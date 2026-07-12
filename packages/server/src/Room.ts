/* ============================================================
   Room — 방 하나의 상태
   ------------------------------------------------------------
   서버는 게임을 모른다. 방이 들고 있는 건 코드·접속자·상태·시드·gameId뿐.
   화살은 각 클라가 시드로 로컬 생성하므로 서버는 관여하지 않는다.

   접속자는 "입장 순서 리스트"로 관리한다 → 호스트가 나가면
   남은 사람 중 가장 먼저 들어온 사람에게 이양(DESIGN.md 4절).
   ============================================================ */

export type RoomState = "waiting" | "countdown" | "playing" | "finished";

export type Member = {
  id: string;
  nickname: string;
  alive: boolean;
  survivalTicks: number;
};

export class Room {
  /** 입장 순서 보존 배열. 인덱스 0이 현재 호스트. */
  private members: Member[] = [];
  state: RoomState = "waiting";
  seed: number | null = null;

  constructor(
    public readonly code: string,
    public readonly gameId: string,
  ) {}

  get hostId(): string | null {
    return this.members[0]?.id ?? null;
  }

  addMember(m: Member): void {
    this.members.push(m);
  }

  /** 판 시작: 시드 배포 + 상태 전환 + 모든 멤버 생존 상태로 리셋(새 시드 재시작 포함). */
  startGame(seed: number): void {
    this.seed = seed;
    this.state = "playing";
    for (const m of this.members) {
      m.alive = true;
      m.survivalTicks = 0;
    }
  }

  /** 로컬 사망 신호 반영. 해당 멤버가 있으면 true. */
  markDied(id: string, survivalTicks: number): boolean {
    const m = this.members.find((x) => x.id === id);
    if (!m || !m.alive) return false;
    m.alive = false;
    m.survivalTicks = survivalTicks;
    return true;
  }

  /** 판 종료. 살아남은 사람(승자)의 생존시간을 "마지막 사망 시점"으로 근사해 둔다
   *  (승자는 그때까지 살아있었으므로 최소 그만큼 버틴 것 — 정확한 표기는 UI 단계에서). */
  finish(): void {
    const maxDead = this.members.reduce((mx, m) => (m.alive ? mx : Math.max(mx, m.survivalTicks)), 0);
    for (const m of this.members) {
      if (m.alive) m.survivalTicks = maxDead;
    }
    this.state = "finished";
  }

  /** 반환값: 호스트가 바뀌었으면 새 호스트 id, 아니면 null. */
  removeMember(id: string): { hostChanged: string | null } {
    const wasHost = this.hostId === id;
    this.members = this.members.filter((m) => m.id !== id);
    if (wasHost && this.hostId) return { hostChanged: this.hostId };
    return { hostChanged: null };
  }

  getMembers(): readonly Member[] {
    return this.members;
  }

  isEmpty(): boolean {
    return this.members.length === 0;
  }
}
