/* ============================================================
   IGame — 게임이 구현할 계약 (잠정 버전)
   ------------------------------------------------------------
   ⚠️ 이 인터페이스는 죽림고수 하나만 보고 설계한 "잠정" 버전이다.
   두 번째 게임을 붙일 때 실제로 안 맞는 부분이 나오면 그때 넓힌다.
   상상으로 미리 넓히지 않는다. (DESIGN.md 3절, 7절 참조)

   core는 이 인터페이스만 알고, 구체 게임(JungnimGame 등)은 모른다.
   ============================================================ */

import type { InputState, SpectateTarget, PeerState } from "./types";
import type { IRenderer } from "./IRenderer";

export interface IGame {
  /** 시드로 결정론 초기화. 여기서 SeededRNG 인스턴스를 만든다. */
  init(seed: number): void;

  /** 고정 스텝(1/60초)마다 호출. 실측 deltaTime을 받지 않는다 — 결정론 불변식.
   *  ⚠️ 공통 월드(모두가 공유하는 시드 기반 부분)는 로컬 플레이어가 죽어도 계속
   *  전진해야 한다 — 관전자가 살아있는 남의 화면을 그리려면 월드가 살아있어야 함. */
  update(tick: number, input: InputState): void;

  /** 자기 자신을 렌더. alpha는 프레임 간 보간용(로직엔 영향 없음). */
  render(r: IRenderer, alpha: number): void;

  /** 관전 렌더: 공통 월드 + 대상(남)의 위치를 그린다. 자기 플레이어는 안 그린다.
   *  (잠정 IGame 확장 — DESIGN 7절이 예고한 "멀티에서 부딪혀 넓히는" 지점.
   *   2번째 게임에서 위치가 2D로 충분한지 검증된다.) */
  renderSpectator(r: IRenderer, target: SpectateTarget): void;

  /** 로컬 사망 판정. 각 클라이언트가 자기 화면에서 판단한다. */
  isPlayerDead(): boolean;

  /** 관전 전송용 자기 위치(게임 좌표계). (잠정 IGame 확장) */
  getPosition(): { x: number; y: number };

  /** 관전 대상(남)들의 현재 위치를 게임에 알린다. 게임은 이 정보로 각자의
   *  로컬 전용 시각 요소를 근사해 renderSpectator에서 그린다.
   *  로컬 전용 요소가 없는 게임은 무시하면 된다. (잠정 IGame 확장) */
  syncPeers(peers: readonly PeerState[]): void;

  /** 순위 기준값. 죽림고수는 생존시간(tick). scoreDirection과 함께 해석된다. */
  getScore(): number;
}
