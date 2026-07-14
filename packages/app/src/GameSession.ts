import { Canvas2DRenderer, GameRunner, InputManager, type GameView } from "@arcade/core";
import type { IGame, PeerSnapshot, PlayerPublic } from "@arcade/shared";
import { GAME_REGISTRY, isGameId, type GameId } from "./GameRegistry";

const SIDE_SLOTS = 3;

type Peer = { nickname: string; alive: boolean; x: number; y: number };
type MainViewMode = "self" | "spectating";

export type GameSessionOptions = {
  mainCanvas: HTMLCanvasElement;
  sideCanvases: readonly HTMLCanvasElement[];
  onLocalDeath: () => void;
  onSideSlot: (index: number, visible: boolean, label: string) => void;
};

/** 한 라운드의 게임 인스턴스, 입력, 관전 대상과 멀티 뷰를 소유한다. */
export class GameSession {
  private readonly input = new InputManager();
  private readonly mainRenderer: Canvas2DRenderer;
  private readonly sideRenderers: Canvas2DRenderer[];
  private game: IGame | null = null;
  private runner: GameRunner | null = null;
  private activeGameId: GameId | null = null;
  private roster: readonly PlayerPublic[] = [];
  private myId: string | null = null;
  private readonly peers = new Map<string, Peer>();
  private spectateId: string | null = null;
  private sideShown: string[] = [];
  private viewMode: MainViewMode = "self";
  private roundActive = false;

  constructor(private readonly options: GameSessionOptions) {
    this.mainRenderer = new Canvas2DRenderer(options.mainCanvas);
    this.sideRenderers = options.sideCanvases.map((canvas) => new Canvas2DRenderer(canvas));
  }

  setRoster(players: readonly PlayerPublic[], myId: string | null): void {
    this.roster = players;
    this.myId = myId;
  }

  start(gameId: string, seed: number, epochPerformanceMs: number): boolean {
    if (!isGameId(gameId)) return false;
    this.ensureRunner(gameId);
    this.buildPeers();
    this.viewMode = "self";
    this.spectateId = null;
    this.sideShown = [];
    this.roundActive = true;
    this.runner?.start(seed, epochPerformanceMs);
    this.syncGamePeers();
    this.rebuildViews();
    return true;
  }

  stopRound(): void {
    this.roundActive = false;
    this.runner?.stop();
  }

  leaveRoom(): void {
    this.stopRound();
    this.peers.clear();
    this.spectateId = null;
    this.sideShown = [];
    for (let index = 0; index < SIDE_SLOTS; index++) this.options.onSideSlot(index, false, "");
  }

  getScore(): number | null {
    return this.game?.getScore() ?? null;
  }

  getPosition(): { x: number; y: number } | null {
    return this.roundActive ? this.game?.getPosition() ?? null : null;
  }

  applySnapshot(snapshot: readonly PeerSnapshot[]): void {
    if (!this.roundActive) return;
    for (const state of snapshot) {
      if (state.id === this.myId) continue;
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
    this.syncGamePeers();
    this.rebuildViews();
  }

  markPeerDead(id: string): void {
    const peer = this.peers.get(id);
    if (peer) peer.alive = false;
    if (id === this.spectateId) this.pickMainSpectate();
    this.syncGamePeers();
    this.rebuildViews();
  }

  showOwnResult(): void {
    this.viewMode = "self";
    this.rebuildViews();
  }

  watchRandomSurvivor(): boolean {
    this.pickMainSpectate();
    if (!this.spectateId) return false;
    this.viewMode = "spectating";
    this.rebuildViews();
    return true;
  }

  private ensureRunner(gameId: GameId): void {
    if (this.activeGameId === gameId) return;
    this.runner?.stop();
    this.game = GAME_REGISTRY[gameId].factory();
    this.runner = new GameRunner(this.game, this.input, this.options.onLocalDeath);
    this.activeGameId = gameId;
  }

  private buildPeers(): void {
    this.peers.clear();
    for (const player of this.roster) {
      if (player.id === this.myId) continue;
      this.peers.set(player.id, {
        nickname: player.nickname,
        alive: player.alive,
        x: this.options.mainCanvas.width / 2,
        y: this.options.mainCanvas.height / 2,
      });
    }
  }

  private syncGamePeers(): void {
    this.game?.syncPeers([...this.peers.entries()]
      .filter(([, peer]) => peer.alive)
      .map(([id, peer]) => ({ id, x: peer.x, y: peer.y })));
  }

  private pickMainSpectate(): void {
    const candidates = [...this.peers.entries()].filter(([, peer]) => peer.alive).map(([id]) => id);
    this.spectateId = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
  }

  private rebuildViews(): void {
    if (!this.runner || !this.roundActive) return;
    let mainTarget: GameView["target"] = null;
    if (this.viewMode === "spectating" && this.spectateId) {
      const peer = this.peers.get(this.spectateId);
      if (peer?.alive) mainTarget = { id: this.spectateId, x: peer.x, y: peer.y, label: peer.nickname };
    }
    const views: GameView[] = [{ renderer: this.mainRenderer, target: mainTarget }];

    const excluded = this.viewMode === "spectating" ? this.spectateId : null;
    const aliveOthers = [...this.peers.entries()]
      .filter(([id, peer]) => peer.alive && id !== excluded)
      .map(([id]) => id);
    this.sideShown = this.sideShown.filter((id) => aliveOthers.includes(id));
    const unshown = aliveOthers.filter((id) => !this.sideShown.includes(id));
    while (unshown.length > 0 && this.sideShown.length < SIDE_SLOTS) {
      const index = Math.floor(Math.random() * unshown.length);
      this.sideShown.push(unshown.splice(index, 1)[0]);
    }
    this.sideShown.forEach((id, index) => {
      const peer = this.peers.get(id);
      if (peer) views.push({
        renderer: this.sideRenderers[index],
        target: { id, x: peer.x, y: peer.y, label: peer.nickname },
      });
    });
    for (let index = 0; index < SIDE_SLOTS; index++) {
      const id = this.sideShown[index];
      this.options.onSideSlot(index, id !== undefined, id ? this.peers.get(id)?.nickname ?? "" : "");
    }
    this.runner.setViews(views);
  }
}
