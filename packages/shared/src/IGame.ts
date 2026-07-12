/* ============================================================
   IGame — 게임이 구현할 계약 (잠정 버전)
   ------------------------------------------------------------
   ⚠️ 이 인터페이스는 죽림고수 하나만 보고 설계한 "잠정" 버전이다.
   두 번째 게임을 붙일 때 실제로 안 맞는 부분이 나오면 그때 넓힌다.
   상상으로 미리 넓히지 않는다. (DESIGN.md 3절, 7절 참조)

   core는 이 인터페이스만 알고, 구체 게임(JungnimGame 등)은 모른다.
   ============================================================ */

import type { InputState } from "./types";
import type { IRenderer } from "./IRenderer";

export interface IGame {
  /** 시드로 결정론 초기화. 여기서 SeededRNG 인스턴스를 만든다. */
  init(seed: number): void;

  /** 고정 스텝(1/60초)마다 호출. 실측 deltaTime을 받지 않는다 — 결정론 불변식. */
  update(tick: number, input: InputState): void;

  /** 자기 자신을 렌더. alpha는 프레임 간 보간용(로직엔 영향 없음). */
  render(r: IRenderer, alpha: number): void;

  /** 로컬 사망 판정. 각 클라이언트가 자기 화면에서 판단한다. */
  isPlayerDead(): boolean;

  /** 순위 기준값. 죽림고수는 생존시간(tick). scoreDirection과 함께 해석된다. */
  getScore(): number;

  /** 재시작용 초기화. */
  reset(): void;
}
