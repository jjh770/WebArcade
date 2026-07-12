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
