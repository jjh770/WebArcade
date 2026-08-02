import { Canvas2DRenderer, CompositeInput, GameRunner, InputManager, TouchInput, type GameView } from "@arcade/core";
import type { IGame, PeerSnapshot, PlayerPublic, SpawnContext } from "@arcade/shared";
import { GAME_REGISTRY, isGameId, type GameEntry, type GameId } from "./GameRegistry";
import { TouchHint, hasCoarsePointer, shouldShowHint } from "./touchHint";
import { Joystick } from "./joystick";
import { TOUCH_SCHEMES } from "./touchSchemes";

const SIDE_SLOTS = 3;

type Peer = { nickname: string; alive: boolean; x: number; y: number };
type MainViewMode = "self" | "spectating";

export type GameSessionOptions = {
  mainCanvas: HTMLCanvasElement;
  sideCanvases: readonly HTMLCanvasElement[];
  /** 터치 조작 안내 오버레이. 메인 캔버스 위에 겹쳐 뜬다. */
  touchHint: HTMLElement;
  /** 조이스틱 위젯(뿌리 / 노브). 사방으로 움직이는 게임에서만 뜬다. */
  stick: HTMLElement;
  stickKnob: HTMLElement;
  /** 게임 좌표계 크기. 화면 크기와 무관하게 고정 — 게임은 항상 이 좌표로만 그린다. */
  logicalWidth: number;
  logicalHeight: number;
  onLocalDeath: () => void;
  onSideSlot: (index: number, visible: boolean, label: string) => void;
  /** 매 프레임 로컬 플레이어 HUD 값(생존 tick, 게이지 0~1 또는 없으면 null). 캔버스 밖 DOM 헤더용. */
  onHud: (score: number, gauge: number | null) => void;
  /** 게임이 방해 발사를 냈고 조준 대상(우측 관전 슬롯 중 1명)이 정해졌을 때.
   *  slotIndex는 그 대상이 떠 있는 관전 슬롯 번호 — 탄환 연출이 날아갈 목적지다.
   *  타깃이 없으면(혼자 남음 등) 아예 호출되지 않는다. */
  onFire: (kind: string, durationMs: number, targetId: string, slotIndex: number) => void;
};

/** 한 라운드의 게임 인스턴스, 입력, 관전 대상과 멀티 뷰를 소유한다. */
export class GameSession {
  // 키보드와 손가락은 같은 InputState를 낸다. 러너는 둘을 구분하지 않는다.
  private readonly keyboard = new InputManager();
  // 조작면이 둘이라 소스도 둘이다. 게임에 맞는 쪽에만 매핑을 끼우고 나머지는 비운다
  // — 요소를 바꿔 끼우는 것보다 리스너 수명이 단순하다.
  private readonly touchCanvas: TouchInput;
  private readonly touchStick: TouchInput;
  private readonly input: CompositeInput;
  private readonly hint: TouchHint;
  private readonly joystick: Joystick;
  /** 이번 게임에 터치 조작이 있는가 — 안내를 띄울지 판단에만 쓴다. */
  private touchable = false;
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
    const { logicalWidth: w, logicalHeight: h } = options;
    // 판 터치는 메인 캔버스 위에서만 받는다 — 관전 슬롯이나 HUD를 눌러 꺾이면 안 된다.
    this.touchCanvas = new TouchInput(options.mainCanvas);
    this.touchStick = new TouchInput(options.stick);
    this.input = new CompositeInput(this.keyboard, this.touchCanvas, this.touchStick);
    this.hint = new TouchHint(options.touchHint, options.mainCanvas);
    this.joystick = new Joystick(options.stick, options.stickKnob);
    this.mainRenderer = new Canvas2DRenderer(options.mainCanvas, w, h);
    this.sideRenderers = options.sideCanvases.map((canvas) => new Canvas2DRenderer(canvas, w, h));
    this.resizeViews();
  }

  /** 각 캔버스의 현재 표시 크기(CSS px)를 읽어 백킹스토어·변환행렬을 다시 맞춘다.
   *  최초 1회 + 창 크기/모니터(DPR) 변경 시 호출. 렌더 전용이라 결정론과 무관하다. */
  resizeViews(): void {
    this.fitRenderer(this.mainRenderer, this.options.mainCanvas);
    this.sideRenderers.forEach((renderer, index) => {
      this.fitRenderer(renderer, this.options.sideCanvases[index]);
    });
    // 안내 오버레이도 캔버스를 따라간다. 떠 있지 않을 때 맞춰 둬도 해가 없다.
    this.hint.syncBox();
  }

  private fitRenderer(renderer: Canvas2DRenderer, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    // 안 보이는 캔버스(좁은 화면에서 접힌 관전 칼럼 등)엔 해상도를 잡지 않는다.
    // 다시 보이게 되면 resize 이벤트가 relayout을 부르고 여기로 돌아온다.
    if (rect.width <= 0 || rect.height <= 0) return;
    renderer.resize(rect.width, rect.height);
  }

  setRoster(players: readonly PlayerPublic[], myId: string | null): void {
    this.roster = players;
    this.myId = myId;
  }

  /** 카운트다운 동안 메인 화면에 빈 경기장 + 중앙 플레이어를 미리 그려둔다.
   *  (안 그리면 러너가 아직 안 돌아 캔버스 원본 배경 = 크림색 사각형이 보인다.) */
  showReadyFrame(gameId: string, seed: number): boolean {
    if (!isGameId(gameId)) return false;
    this.ensureRunner(gameId);
    this.runner?.setViews([{ renderer: this.mainRenderer, target: null }]);
    this.runner?.prime(seed, this.selfContext());
    // 조작 안내는 카운트다운 동안 판 위에 깔린다(숫자 뒤). start()에서 걷힌다.
    if (shouldShowHint(this.touchable, hasCoarsePointer())) this.hint.show();
    return true;
  }

  /** 이 클라의 스폰 신원. 멀티(인원 2+)에서만 유효 — 로스터 내 순번과 인원을 준다.
   *  솔로거나 아직 나 혼자면 undefined(게임이 단일 스폰을 쓴다). 전원이 같은
   *  로스터를 공유하므로 같은 스폰 집합에서 각자 다른 슬롯을 고르게 된다. */
  private selfContext(): SpawnContext | undefined {
    if (!this.myId || this.roster.length <= 1) return undefined;
    const index = this.roster.findIndex((player) => player.id === this.myId);
    return index < 0 ? undefined : { index, count: this.roster.length };
  }

  start(gameId: string, seed: number, epochPerformanceMs: number): boolean {
    if (!isGameId(gameId)) return false;
    this.ensureRunner(gameId);
    this.buildPeers();
    this.viewMode = "self";
    this.spectateId = null;
    this.sideShown = [];
    this.roundActive = true;
    this.runner?.start(seed, epochPerformanceMs, this.selfContext());
    this.syncGamePeers();
    this.rebuildViews();
    // 카운트다운 동안 깔려 있던 조작 안내를 걷는다 — 플레이 화면은 가리지 않는다.
    this.hint.hide();
    return true;
  }

  stopRound(): void {
    this.roundActive = false;
    this.runner?.stop();
    this.hint.hide();
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

  /** 이번 위치 전송에 얹어 보낼 시각 이벤트(없으면 null). 게임이 정하고 서버는 의미를 모른다. */
  takePeerEvent(): string | null {
    return this.roundActive ? this.game?.consumePeerEvent?.() ?? null : null;
  }

  applySnapshot(snapshot: readonly PeerSnapshot[]): void {
    if (!this.roundActive) return;
    for (const state of snapshot) {
      if (state.id === this.myId) continue;
      // 남이 낸 시각 이벤트는 그 사람 관전 화면에 그대로 재현한다(서버는 한 번만 실어 보낸다).
      if (state.ev !== undefined) this.game?.applyPeerEvent?.(state.id, state.ev);
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

  /** 게임이 발사를 냈다(디버프 풀 도착). 풀에서 랜덤 1개를 뽑고, 우측 관전 슬롯(sideShown)에
   *  지금 떠 있는 살아있는 상대 중 랜덤 1명을 조준해 전송한다 — "보이는 사람만 맞힌다".
   *  정말 혼자 남아 조준 대상이 없으면 발사를 흘려버린다(마지막 생존자는 어차피 이긴 상황).
   *  Math.random은 네트워킹/연출용이라 게임 결정론과 무관하다. */
  private handleFire(debuffs: readonly { kind: string; durationMs: number }[]): void {
    const targets = this.sideShown.filter((id) => this.peers.get(id)?.alive);
    if (targets.length === 0 || debuffs.length === 0) return;
    const targetId = targets[Math.floor(Math.random() * targets.length)]!;
    const debuff = debuffs[Math.floor(Math.random() * debuffs.length)]!;
    // 슬롯 번호는 sideShown 기준(targets는 살아있는 것만 걸러낸 부분집합이라 번호가 다르다).
    this.options.onFire(debuff.kind, debuff.durationMs, targetId, this.sideShown.indexOf(targetId));
  }

  /** 남의 발사에 맞았다. 라운드 중이고 내가 아직 살아있을 때만 게임에 조작계 효과를 적용한다.
   *  적용됐으면 true를 돌려 앱이 화면 연출(배너·시각 디버프)도 같이 걸게 한다. 관전·대기·
   *  사망 중이면 false(연출도 안 건다). 시각계 kind는 게임이 무시하지만 여기선 true를 준다. */
  applyEffect(kind: string, durationMs: number): boolean {
    if (!this.roundActive || !this.game || this.game.isPlayerDead()) return false;
    this.runner?.applyEffect(kind, durationMs);
    return true;
  }

  markPeerDead(id: string): void {
    const peer = this.peers.get(id);
    if (peer) peer.alive = false;
    if (id === this.spectateId) this.pickMainSpectate();
    this.syncGamePeers();
    this.rebuildViews();
  }

  watchRandomSurvivor(): boolean {
    this.pickMainSpectate();
    if (!this.spectateId) return false;
    this.viewMode = "spectating";
    this.rebuildViews();
    return true;
  }

  /** 관전 중 메인 대상을 다음(+1)/이전(-1) 생존자로 넘긴다. 넘어갔으면 true.
   *  대상을 "고르는" 게 아니라 살아있는 사람들을 순환한다 — 오른쪽에 보이던 사람이
   *  메인으로 올라오는 카드 넘기기 느낌. 생존자가 1명뿐이면 넘길 곳이 없다. */
  cycleSpectate(direction: number): boolean {
    if (this.viewMode !== "spectating") return false;
    const order = this.aliveSpectateOrder();
    if (order.length <= 1) return false;
    const current = this.spectateId ? order.indexOf(this.spectateId) : -1;
    const next = (((current + direction) % order.length) + order.length) % order.length;
    this.spectateId = order[next];
    this.rebuildViews();
    return true;
  }

  /** 순환 순서 = 로스터(입장) 순으로 고정된 살아있는 남들. 순서가 고정돼야 ←/→가 예측 가능하다. */
  private aliveSpectateOrder(): string[] {
    return this.roster
      .filter((player) => player.id !== this.myId && this.peers.get(player.id)?.alive)
      .map((player) => player.id);
  }

  private ensureRunner(gameId: GameId): void {
    if (this.activeGameId === gameId) return;
    this.runner?.stop();
    // 터치 매핑은 게임마다 다르다. 없는 게임은 그대로 키보드 전용으로 돈다.
    // (레지스트리는 satisfies라 항목마다 리터럴 타입이다 — 선택 필드를 보려면 계약으로 넓힌다.)
    const entry: GameEntry = GAME_REGISTRY[gameId];
    const scheme = entry.touch ? TOUCH_SCHEMES[entry.touch] : null;
    // 이 게임이 쓰는 조작면에만 매핑을 끼운다. 나머지 면은 눌러도 아무 일이 없다.
    this.touchCanvas.setMapper(scheme?.surface === "canvas" ? scheme.map : null);
    this.touchStick.setMapper(scheme?.surface === "stick" ? scheme.map : null);
    this.joystick.setVisible(scheme?.surface === "stick" && hasCoarsePointer());
    this.hint.setScheme(entry.touch ?? null);
    this.touchable = entry.touch !== undefined;
    this.game = entry.factory();
    this.runner = new GameRunner(this.game, this.input, this.options.onLocalDeath, this.options.onHud, (debuffs) => this.handleFire(debuffs));
    this.activeGameId = gameId;
  }

  private buildPeers(): void {
    this.peers.clear();
    for (const player of this.roster) {
      if (player.id === this.myId) continue;
      // 첫 스냅샷이 오기 전 임시 위치: 게임 좌표계 중앙.
      // (캔버스 픽셀 크기는 DPR·화면 크기에 따라 변하므로 절대 쓰지 않는다.)
      this.peers.set(player.id, {
        nickname: player.nickname,
        alive: player.alive,
        x: this.options.logicalWidth / 2,
        y: this.options.logicalHeight / 2,
      });
    }
  }

  private syncGamePeers(): void {
    this.game?.syncPeers([...this.peers.entries()]
      .filter(([, peer]) => peer.alive)
      .map(([id, peer]) => ({ id, x: peer.x, y: peer.y, label: peer.nickname })));
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
