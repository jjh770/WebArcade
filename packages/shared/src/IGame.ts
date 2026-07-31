/* ============================================================
   IGame — 게임이 구현할 계약
   ------------------------------------------------------------
   core는 이 인터페이스만 알고, 구체 게임(JungnimGame 등)은 모른다.

   죽림고수 하나만 보고 만든 잠정 계약이었고, 둘째 게임(커브 피버)이 실제로
   붙으면서 검증됐다 — 넓힌 곳은 선택 메서드뿐이고 필수 계약은 그대로였다.
   관전 데이터는 위치 하나로 충분했고(꼬리 이력은 받는 쪽이 쌓는다), 입력도
   4방향의 부분집합으로 족했다. (DESIGN.md 3절 "잠정적으로 열어둘 지점" 참조)

   ⚠️ 선택 메서드는 여기까지다. 세 번째 게임이 실제로 요구하기 전에는 넓히지
   않는다 — 상상으로 넓힌 계약은 빈 구현을 강요한다. */

import type { InputState, SpectateTarget, PeerState, SpawnContext } from "./types";
import type { IRenderer } from "./IRenderer";

export interface IGame {
  /** 시드로 결정론 초기화. 여기서 SeededRNG 인스턴스를 만든다.
   *  self는 멀티에서 이 클라의 신원(순번·인원) — 플레이어별로 스폰을 나눠 갖는 게임만
   *  쓴다. 스폰이 고정인 게임은 매개변수를 아예 안 받아 무시하면 된다(TS는 매개변수를
   *  덜 받는 구현을 허용한다 — 죽림고수의 init(seed)가 그대로 이 계약을 만족한다). */
  init(seed: number, self?: SpawnContext): void;

  /** 고정 스텝(1/60초)마다 호출. 실측 deltaTime을 받지 않는다 — 결정론 불변식.
   *  ⚠️ 공통 월드(모두가 공유하는 시드 기반 부분)는 로컬 플레이어가 죽어도 계속
   *  전진해야 한다 — 관전자가 살아있는 남의 화면을 그리려면 월드가 살아있어야 함. */
  update(tick: number, input: InputState): void;

  /** 자기 자신을 렌더. alpha는 프레임 간 보간용(로직엔 영향 없음). */
  render(r: IRenderer, alpha: number): void;

  /** 관전 렌더: 공통 월드 + 대상(남)의 위치를 그린다. 자기 플레이어는 안 그린다. */
  renderSpectator(r: IRenderer, target: SpectateTarget): void;

  /** 로컬 사망 판정. 각 클라이언트가 자기 화면에서 판단한다. */
  isPlayerDead(): boolean;

  /** 관전 전송용 자기 위치(게임 좌표계). */
  getPosition(): { x: number; y: number };

  /** 관전 대상(남)들의 현재 위치를 게임에 알린다. 게임은 이 정보로 각자의
   *  로컬 전용 시각 요소를 근사해 renderSpectator에서 그린다.
   *  로컬 전용 요소가 없는 게임은 무시하면 된다. */
  syncPeers(peers: readonly PeerState[]): void;

  /** 순위 기준값. 죽림고수는 생존시간(tick). scoreDirection과 함께 해석된다. */
  getScore(): number;

  /** (선택) 게임 고유의 게이지 값(0~1) — 캔버스 밖 DOM HUD에 바로 표시된다.
   *  커브 피버의 「스릴 게이지」가 이걸 구현한다. 게이지가 없는 게임은 구현 안 하면
   *  된다(그러면 HUD가 게이지 줄을 숨긴다). */
  getGauge?(): number;

  /** (선택) 이번 스텝에 상대에게 쏠 방해 발사가 있으면 걸 수 있는 **디버프 풀**을 돌려주고
   *  소비한다. 러너가 매 스텝 폴링한다. 이 중 하나를 뽑아(랜덤) 누구에게 보낼지는 앱이 정한다
   *  — 게임 update와 core·서버는 슬러그를 모른다. 없으면 null. */
  consumePendingFire?(): readonly { kind: string; durationMs: number }[] | null;

  /** (선택) 이번 스텝에 **남들 화면에도 보여야 할** 시각 이벤트가 생겼으면 그 슬러그를
   *  돌려주고 소비한다(없으면 null). 앱이 위치 전송에 얹어 보내고, 서버는 의미를 모른 채
   *  다음 스냅샷에 한 번 실어 중계한다.
   *  ⚠️ 판정이 아니라 **연출 동기화 전용**이다. 이게 유실돼도 게임 진행은 갈리지 않는다
   *  — 로컬에서만 일어난 일(예: 내가 지운 화살)을 남의 관전 화면에서 흉내 내기 위한 것. */
  consumePeerEvent?(): string | null;

  /** (선택) 남이 낸 시각 이벤트가 도착했다. 그 사람을 관전 중일 때 같은 연출을 재현한다.
   *  모르는 kind는 무시한다. */
  applyPeerEvent?(id: string, kind: string): void;

  /** (선택) 남의 발사에 맞았을 때 호출. 게임이 아는 kind면 자기 로컬 상태에만 효과를
   *  적용한다(예: 좌우 조작 반전·회전 둔화). 결정론 안전 — 공통 월드가 아니라 그 클라의
   *  입력/시야만 바뀐다. 시각계·모르는 kind는 무시한다(화면 연출은 앱이 처리). */
  applyEffect?(kind: string, durationMs: number): void;
}
