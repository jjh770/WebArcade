/* ============================================================
   GameSession — 한 라운드의 게임 인스턴스와 러너를 소유한다
   ------------------------------------------------------------
   가진 것: 게임 인스턴스, 러너, 캔버스 렌더러, 라운드 진행 여부.
   맡기는 것:
   - 손가락 조작면 일체 → TouchControls (입력 소스이자 레이아웃 정책)
   - 남들의 상태와 화면 배분 → PeerViews (관전·슬롯·조준)

   세션이 하는 일은 그 둘을 게임/러너에 이어 주는 것뿐이다.
   ============================================================ */

import {
  Canvas2DRenderer,
  CompositeInput,
  GameRunner,
  InputManager,
  KeyEntry,
  PointerInput,
} from "@arcade/core";
import type { IGame, PeerSnapshot, PlayerPublic, SpectateSignal } from "@arcade/shared";
import { isSoundId, play } from "./audio";
import { GAME_REGISTRY, isGameId, type GameEntry, type GameId } from "./GameRegistry";
import { PeerViews } from "./peerViews";
import { TouchControls } from "./touchControls";

const SIDE_SLOTS = 3;

export type GameSessionOptions = {
  mainCanvas: HTMLCanvasElement;
  sideCanvases: readonly HTMLCanvasElement[];
  /** 터치 조작 안내 오버레이. 메인 캔버스 위에 겹쳐 뜬다. */
  touchHint: HTMLElement;
  /** 조이스틱 위젯(뿌리 / 노브). 사방으로 움직이는 게임에서만 뜬다. */
  stick: HTMLElement;
  stickKnob: HTMLElement;
  /** 방향키 버튼 뿌리. 격자를 한 칸씩 옮기는 게임에서만 뜬다. */
  dpad: HTMLElement;
  /** 숫자판 뿌리. 숫자를 치는 게임에서만 뜬다. */
  keypad: HTMLElement;
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
  /** 조작 영역의 유무가 바뀌어 **판이 쓸 세로가 달라졌다.** 판 크기를 다시 잡아야 한다
   *  — 세션은 자기가 캔버스를 얼마나 크게 쓸지 정하지 않는다(레이아웃은 앱 몫). */
  onControlsChange: () => void;
};

export class GameSession {
  // 키보드와 손가락은 같은 InputState를 낸다. 러너는 둘을 구분하지 않는다.
  private readonly keyboard = new InputManager();
  /** 글자 입력. 방향과 달리 **게임이 요구할 때만** 켠다 — 켜져 있으면 Enter·Backspace의
   *  기본 동작을 삼키므로, 숫자를 안 받는 게임에서까지 켜 둘 이유가 없다. */
  private readonly typing = new KeyEntry((slug) => this.runner?.typeKey(slug));
  private typingOn = false;
  /** 포인터 입력(조준·발사). 글자와 같은 이유로 **게임이 요구할 때만** 켠다 — 켜져 있으면
   *  판 위에서 움직이는 마우스를 매번 좇게 되고, 안 쓰는 게임에는 아무 뜻이 없는 일이다. */
  private readonly aiming: PointerInput;
  private aimingOn = false;
  private readonly touch: TouchControls;
  private readonly input: CompositeInput;
  private readonly views: PeerViews;
  private readonly mainRenderer: Canvas2DRenderer;
  private readonly sideRenderers: Canvas2DRenderer[];
  private game: IGame | null = null;
  private runner: GameRunner | null = null;
  private activeGameId: GameId | null = null;
  private roundActive = false;

  constructor(private readonly options: GameSessionOptions) {
    const { logicalWidth: w, logicalHeight: h } = options;
    this.touch = new TouchControls({
      // 판 터치는 메인 캔버스 위에서만 받는다 — 관전 슬롯이나 HUD를 눌러 꺾이면 안 된다.
      board: options.mainCanvas,
      hint: options.touchHint,
      stick: options.stick,
      stickKnob: options.stickKnob,
      dpad: options.dpad,
      keypad: options.keypad,
      onSpaceChange: options.onControlsChange,
      // 손가락이 낸 슬러그도 키보드와 **같은 문으로** 들어간다 — 게임은 출처를 모른다.
      onKey: (slug) => this.runner?.typeKey(slug),
    });
    // 조준도 판 위에서 받는다. 손가락 조작면과 달리 **마우스도 함께** 받으므로
    // TouchControls 안이 아니라 여기 따로 선다 — 저기는 손가락 전용 조작면의 집이다.
    this.aiming = new PointerInput(
      options.mainCanvas,
      (nx, ny) => this.runner?.aim(nx, ny),
      (nx, ny) => this.runner?.fire(nx, ny),
    );
    this.input = new CompositeInput(this.keyboard, this.touch);
    this.views = new PeerViews({
      slots: SIDE_SLOTS,
      logicalWidth: w,
      logicalHeight: h,
      onSideSlot: options.onSideSlot,
    });
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
    this.touch.syncHintBox();
    // 판이 움직였으니 조준이 들고 있던 자리도 무효다. 안 알리면 창을 줄인 뒤부터
    // 조준점이 마우스와 어긋난 채로 따라온다.
    this.aiming.syncBox();
  }

  private fitRenderer(renderer: Canvas2DRenderer, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    // 안 보이는 캔버스(좁은 화면에서 접힌 관전 칼럼 등)엔 해상도를 잡지 않는다.
    // 다시 보이게 되면 resize 이벤트가 relayout을 부르고 여기로 돌아온다.
    if (rect.width <= 0 || rect.height <= 0) return;
    renderer.resize(rect.width, rect.height);
  }

  setRoster(players: readonly PlayerPublic[], myId: string | null): void {
    this.views.setRoster(players, myId);
  }

  /** 곁창(우측 관전창)을 켜고 끈다. 각자의 설정이라 방과 무관하다. */
  setSideViews(on: boolean): void {
    this.views.setSideViews(on);
  }

  /** 카운트다운 동안 메인 화면에 빈 경기장 + 중앙 플레이어를 미리 그려둔다.
   *  (안 그리면 러너가 아직 안 돌아 캔버스 원본 배경 = 크림색 사각형이 보인다.) */
  showReadyFrame(gameId: string, seed: number): boolean {
    if (!isGameId(gameId)) return false;
    this.ensureRunner(gameId);
    // 조작을 먼저 세운다 — 판 크기가 조작 영역에 달렸으므로, 그리기 전에 자리가 정해져야
    // 카운트다운 동안 내려오는 판이 곧바로 제 크기다.
    this.touch.setUsable(true);
    this.runner?.setViews([{ renderer: this.mainRenderer, target: null }]);
    this.runner?.prime(seed, this.views.selfContext());
    // 조작 안내는 카운트다운 동안 판 위에 깔린다(숫자 뒤). start()에서 걷힌다.
    this.touch.showHint();
    return true;
  }

  start(gameId: string, seed: number, epochPerformanceMs: number): boolean {
    if (!isGameId(gameId)) return false;
    this.ensureRunner(gameId);
    this.views.reset();
    this.roundActive = true;
    // ⚠️ ensureRunner는 같은 게임이면 일찍 빠져나간다. 조작 상태를 거기서만 세우면
    //    관전으로 걷힌 조작이 "다시 하기"에서 안 돌아온다.
    this.touch.setUsable(true);
    this.setTyping(typeof this.game?.typeKey === "function");
    // 둘 중 **하나라도** 쓰면 켠다 — 조준 없이 톡톡 치기만 하는 게임도 있을 수 있다.
    this.setAiming(typeof this.game?.aim === "function" || typeof this.game?.fire === "function");
    this.runner?.start(seed, epochPerformanceMs, this.views.selfContext());
    this.refresh();
    // 카운트다운 동안 깔려 있던 조작 안내를 걷는다 — 플레이 화면은 가리지 않는다.
    this.touch.hideHint();
    return true;
  }

  stopRound(): void {
    this.roundActive = false;
    this.runner?.stop();
    // 판이 끝나면 키보드도 놓는다 — 결과 화면에서 Enter를 눌러 버튼을 누르는 길을
    // 막으면 안 되고, 죽은 뒤의 숫자 입력은 게임이 이미 무시한다.
    this.setTyping(false);
    // 조준도 놓는다 — 관전 중에 내 마우스가 남의 판을 겨눌 일은 없다.
    this.setAiming(false);
    this.touch.hideHint();
    // 라운드가 끝나면 조작면도 걷는다. CSS가 body.playing으로 이미 감추지만,
    // 세로 예산 클래스는 남아 다음 라운드까지 판을 괜히 작게 잡는다.
    this.touch.setUsable(false);
  }

  leaveRoom(): void {
    this.stopRound();
    this.views.clear();
  }

  /** 글자 입력을 켜고 끈다. 두 번 켜도 리스너는 하나다(KeyEntry가 막지만
   *  여기서도 상태를 들고 있어야 "지금 켜져 있나"를 밖에서 물을 수 있다). */
  private setTyping(on: boolean): void {
    if (on === this.typingOn) return;
    this.typingOn = on;
    if (on) this.typing.start();
    else this.typing.stop();
  }

  /** 조준 입력을 켜고 끈다. 켤 때 판을 다시 재게 한다 — 켜지는 시점은 판이 막
   *  내려앉은 직후라, 지난 라운드에 재 둔 자리가 남아 있으면 첫 조준이 어긋난다. */
  private setAiming(on: boolean): void {
    if (on === this.aimingOn) return;
    this.aimingOn = on;
    if (on) this.aiming.start();
    else this.aiming.stop();
  }

  getScore(): number | null {
    return this.game?.getScore() ?? null;
  }

  /** 이번 보고에 실을 관전 신호(판이 안 돌면 null). 뜻은 게임이 정한다 — 세션은 나르기만. */
  getPosition(): SpectateSignal | null {
    return this.roundActive ? this.game?.getPosition() ?? null : null;
  }

  /** 이번 위치 전송에 얹어 보낼 시각 이벤트(없으면 null). 게임이 정하고 서버는 의미를 모른다. */
  takePeerEvent(): string | null {
    return this.roundActive ? this.game?.consumePeerEvent?.() ?? null : null;
  }

  applySnapshot(snapshot: readonly PeerSnapshot[]): void {
    if (!this.roundActive) return;
    // 남이 낸 시각 이벤트는 그 사람 관전 화면에 그대로 재현한다(서버는 한 번만 실어 보낸다).
    this.views.applySnapshot(snapshot, (id, ev) => this.game?.applyPeerEvent?.(id, ev));
    this.refresh();
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
    this.views.markDead(id);
    this.refresh();
  }

  watchRandomSurvivor(): boolean {
    // 죽은 뒤의 조작면은 눌러도 아무 일이 없다. 화면만 먹고 관전 힌트와도 겹치므로
    // 걷는다 — 그만큼 세로가 남아 관전 화면이 커진다.
    this.touch.setUsable(false);
    if (!this.views.watchRandom()) return false;
    this.refresh();
    return true;
  }

  cycleSpectate(direction: number): boolean {
    if (!this.views.cycle(direction)) return false;
    this.refresh();
    return true;
  }

  /** 게임이 발사를 냈다(디버프 풀 도착). 풀에서 랜덤 1개를 뽑고, 지금 우측에 떠 있는
   *  살아있는 상대 하나를 조준해 앱에 넘긴다. Math.random은 연출·네트워킹용이라
   *  게임 결정론과 무관하다. */
  private handleFire(debuffs: readonly { kind: string; durationMs: number }[]): void {
    if (debuffs.length === 0) return;
    const aim = this.views.pickFireTarget();
    if (!aim) return;
    const debuff = debuffs[Math.floor(Math.random() * debuffs.length)]!;
    this.options.onFire(debuff.kind, debuff.durationMs, aim.targetId, aim.slotIndex);
  }

  /** 남의 상태가 바뀌었다 — 게임에 알리고(관전 화면 재구성용) 뷰 배분을 다시 한다.
   *  둘은 항상 같이 간다. 하나만 하면 화면과 내용이 어긋난다. */
  private refresh(): void {
    if (!this.runner || !this.roundActive) return;
    // 남의 시각 요소를 쌓지 않는 게임은 이 메서드를 아예 갖지 않는다(선택 계약).
    this.game?.syncPeers?.(this.views.alivePeers());
    this.runner.setViews(this.views.buildViews(this.mainRenderer, this.sideRenderers));
  }

  private ensureRunner(gameId: GameId): void {
    if (this.activeGameId === gameId) return;
    this.runner?.stop();
    // 터치 조작은 게임마다 다르다. 없는 게임은 그대로 키보드 전용으로 돈다.
    // (레지스트리는 satisfies라 항목마다 리터럴 타입이다 — 선택 필드를 보려면 계약으로 넓힌다.)
    const entry: GameEntry = GAME_REGISTRY[gameId];
    this.touch.useScheme(entry.touch);
    this.game = entry.factory();
    this.runner = new GameRunner(
      this.game,
      this.input,
      this.options.onLocalDeath,
      this.options.onHud,
      (debuffs) => this.handleFire(debuffs),
      // 게임이 낸 슬러그를 같은 이름의 소리로 옮긴다. 표에 없는 이름은 그냥 지나간다
      // — 소리 없는 이벤트를 내는 게임이 생겨도 여기 손댈 일이 없다.
      (slugs) => {
        for (const slug of slugs) if (isSoundId(slug)) play(slug);
      },
    );
    this.activeGameId = gameId;
  }
}
