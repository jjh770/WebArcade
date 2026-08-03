/* ============================================================
   peerViews — 남들의 상태와 "누구를 어느 화면에 띄우는가"
   ------------------------------------------------------------
   한 라운드에서 남에 관한 것이 전부 여기 있다: 각자의 위치·생사, 메인 화면이
   누구를 보고 있는지(내 화면 / 관전), 우측 슬롯에 누가 떠 있는지.

   왜 GameSession에서 뗐나: 이 묶음은 자기들끼리만 참조한다(관전 대상이 죽으면
   슬롯이 바뀌고, 슬롯이 바뀌면 발사 조준 대상이 바뀐다). 세션에 같이 두면
   러너 수명과 이 상태 기계가 한 클래스에서 얽힌다.

   ⚠️ 여기서 Math.random을 쓰는 곳들(관전 대상·슬롯·조준)은 전부 **연출·네트워킹**
      이라 게임 결정론과 무관하다. 게임 판정에 들어가는 난수는 SeededRNG뿐이다.
   ============================================================ */

import type { GameView } from "@arcade/core";
import type { Canvas2DRenderer } from "@arcade/core";
import type { PeerSnapshot, PeerState, PlayerPublic } from "@arcade/shared";

type Peer = { nickname: string; alive: boolean; x: number; y: number };
type MainViewMode = "self" | "spectating";

export type PeerViewsOptions = {
  /** 우측 관전 슬롯 개수. 렌더러 개수와 같아야 한다. */
  slots: number;
  /** 첫 스냅샷이 오기 전 임시 위치(게임 좌표계 중앙). 캔버스 픽셀이 아니다 —
   *  픽셀 크기는 DPR·화면 크기에 따라 변한다. */
  logicalWidth: number;
  logicalHeight: number;
  onSideSlot: (index: number, visible: boolean, label: string) => void;
};

export class PeerViews {
  private readonly peers = new Map<string, Peer>();
  private roster: readonly PlayerPublic[] = [];
  private myId: string | null = null;
  private spectateId: string | null = null;
  private sideShown: string[] = [];
  private viewMode: MainViewMode = "self";

  constructor(private readonly options: PeerViewsOptions) {}

  setRoster(players: readonly PlayerPublic[], myId: string | null): void {
    this.roster = players;
    this.myId = myId;
  }

  /** 이 클라의 스폰 신원. 멀티(인원 2+)에서만 유효 — 로스터 내 순번과 인원을 준다.
   *  솔로거나 아직 나 혼자면 undefined(게임이 단일 스폰을 쓴다). 전원이 같은
   *  로스터를 공유하므로 같은 스폰 집합에서 각자 다른 슬롯을 고르게 된다. */
  selfContext(): { index: number; count: number } | undefined {
    if (!this.myId || this.roster.length <= 1) return undefined;
    const index = this.roster.findIndex((player) => player.id === this.myId);
    return index < 0 ? undefined : { index, count: this.roster.length };
  }

  /** 새 라운드 시작. 로스터를 기준으로 남들을 다시 세우고 내 화면으로 돌아온다. */
  reset(): void {
    this.peers.clear();
    for (const player of this.roster) {
      if (player.id === this.myId) continue;
      this.peers.set(player.id, {
        nickname: player.nickname,
        alive: player.alive,
        x: this.options.logicalWidth / 2,
        y: this.options.logicalHeight / 2,
      });
    }
    this.viewMode = "self";
    this.spectateId = null;
    this.sideShown = [];
  }

  /** 방을 나갔다 — 남에 관한 모든 것을 버리고 슬롯도 전부 내린다. */
  clear(): void {
    this.peers.clear();
    this.spectateId = null;
    this.sideShown = [];
    for (let index = 0; index < this.options.slots; index++) this.options.onSideSlot(index, false, "");
  }

  /** 서버 스냅샷 반영. 남이 낸 시각 이벤트는 onEvent로 흘려보낸다(게임이 재현한다). */
  applySnapshot(snapshot: readonly PeerSnapshot[], onEvent: (id: string, ev: string) => void): void {
    for (const state of snapshot) {
      if (state.id === this.myId) continue;
      if (state.ev !== undefined) onEvent(state.id, state.ev);
      const existing = this.peers.get(state.id);
      if (existing) {
        existing.x = state.px;
        existing.y = state.py;
      } else {
        const player = this.roster.find((candidate) => candidate.id === state.id);
        this.peers.set(state.id, {
          nickname: player?.nickname ?? "플레이어",
          alive: true,
          x: state.px,
          y: state.py,
        });
      }
    }
  }

  markDead(id: string): void {
    const peer = this.peers.get(id);
    if (peer) peer.alive = false;
    if (id === this.spectateId) this.pickMainSpectate();
  }

  /** 살아있는 남 아무나 골라 관전으로 넘어간다. 볼 사람이 없으면 false. */
  watchRandom(): boolean {
    this.pickMainSpectate();
    if (!this.spectateId) return false;
    this.viewMode = "spectating";
    return true;
  }

  /** 관전 중 메인 대상을 다음(+1)/이전(-1) 생존자로 넘긴다. 넘어갔으면 true.
   *  대상을 "고르는" 게 아니라 살아있는 사람들을 순환한다 — 오른쪽에 보이던 사람이
   *  메인으로 올라오는 카드 넘기기 느낌. 생존자가 1명뿐이면 넘길 곳이 없다. */
  cycle(direction: number): boolean {
    if (this.viewMode !== "spectating") return false;
    const order = this.aliveSpectateOrder();
    if (order.length <= 1) return false;
    const current = this.spectateId ? order.indexOf(this.spectateId) : -1;
    const next = (((current + direction) % order.length) + order.length) % order.length;
    this.spectateId = order[next];
    return true;
  }

  /** 게임에 넘길 살아있는 남들(관전 화면 재구성용). */
  alivePeers(): PeerState[] {
    return [...this.peers.entries()]
      .filter(([, peer]) => peer.alive)
      .map(([id, peer]) => ({ id, x: peer.x, y: peer.y, label: peer.nickname }));
  }

  /** 발사 조준: **지금 우측에 떠 있는** 살아있는 상대 중 하나. "보이는 사람만 맞힌다".
   *  정말 혼자 남아 조준할 데가 없으면 null(마지막 생존자는 어차피 이긴 상황). */
  pickFireTarget(): { targetId: string; slotIndex: number } | null {
    const targets = this.sideShown.filter((id) => this.peers.get(id)?.alive);
    if (targets.length === 0) return null;
    const targetId = targets[Math.floor(Math.random() * targets.length)]!;
    // 슬롯 번호는 sideShown 기준(targets는 살아있는 것만 걸러낸 부분집합이라 번호가 다르다).
    return { targetId, slotIndex: this.sideShown.indexOf(targetId) };
  }

  /** 메인 + 우측 슬롯의 뷰 목록. 슬롯 표시(라벨·켜짐)도 여기서 함께 갱신한다 —
   *  누가 어디 떠 있는지는 이 목록을 만드는 순간에만 정해지기 때문이다. */
  buildViews(main: Canvas2DRenderer, sides: readonly Canvas2DRenderer[]): GameView[] {
    let mainTarget: GameView["target"] = null;
    if (this.viewMode === "spectating" && this.spectateId) {
      const peer = this.peers.get(this.spectateId);
      if (peer?.alive) mainTarget = { id: this.spectateId, x: peer.x, y: peer.y, label: peer.nickname };
    }
    const views: GameView[] = [{ renderer: main, target: mainTarget }];

    const excluded = this.viewMode === "spectating" ? this.spectateId : null;
    const aliveOthers = [...this.peers.entries()]
      .filter(([id, peer]) => peer.alive && id !== excluded)
      .map(([id]) => id);
    this.sideShown = this.sideShown.filter((id) => aliveOthers.includes(id));
    const unshown = aliveOthers.filter((id) => !this.sideShown.includes(id));
    while (unshown.length > 0 && this.sideShown.length < this.options.slots) {
      const index = Math.floor(Math.random() * unshown.length);
      this.sideShown.push(unshown.splice(index, 1)[0]);
    }
    this.sideShown.forEach((id, index) => {
      const peer = this.peers.get(id);
      if (peer) views.push({
        renderer: sides[index],
        target: { id, x: peer.x, y: peer.y, label: peer.nickname },
      });
    });
    for (let index = 0; index < this.options.slots; index++) {
      const id = this.sideShown[index];
      this.options.onSideSlot(index, id !== undefined, id ? this.peers.get(id)?.nickname ?? "" : "");
    }
    return views;
  }

  /** 순환 순서 = 로스터(입장) 순으로 고정된 살아있는 남들. 순서가 고정돼야 ←/→가 예측 가능하다. */
  private aliveSpectateOrder(): string[] {
    return this.roster
      .filter((player) => player.id !== this.myId && this.peers.get(player.id)?.alive)
      .map((player) => player.id);
  }

  private pickMainSpectate(): void {
    const candidates = [...this.peers.entries()].filter(([, peer]) => peer.alive).map(([id]) => id);
    this.spectateId = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
  }
}
