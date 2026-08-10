/* ============================================================
   arrowField — 화살이 어떻게 움직이고 무엇에 닿는가
   ------------------------------------------------------------
   이 파일이 **판정의 심장**이다. 죽음은 여기서 정해진다(findHit).

   왜 JungnimGame에서 뗐나: 저 클래스가 하는 일은 크게 셋인데 — 한 판의 상태를 들고,
   화살을 굴리고, 그림을 그린다 — 그중 **이것만 순수 기하**다. 게임 상태도 tick도
   모르고, 풀과 점 하나만 받아 계산한다. 섞여 있으면 "이 계산이 어떤 상태에 기대는가"를
   매번 다시 확인해야 하는데, 떼어 두면 시그니처가 그 답이다.

   ⚠️ 전부 **순수 함수**로 둔다. 여기에 상태가 생기면 그 순간 결정론의 표면이 넓어진다 —
      지금은 "같은 풀 + 같은 점이면 같은 결과"가 시그니처만 보고 확인된다.
   ⚠️ Math.random을 쓰지 않는다. 시드에서 나오지 않은 값이 판정에 들어가면 클라마다
      다른 사람이 죽는다.
   ============================================================ */

import { jungnimConfig } from "./config";
import type { Arrow, ArrowPool } from "./ArrowPool";

/** 활성 화살을 한 스텝 전진시키고, 경기장 원 밖으로 나간 것은 풀로 반납한다. */
export function advanceArrows(pool: ArrowPool): void {
  const { cx, cy, radius } = jungnimConfig.arena;
  const cull = radius + jungnimConfig.arrowLength; // 둘레를 이만큼 벗어나면 사라진다.
  const cull2 = cull * cull;
  for (const a of pool.items) {
    if (!a.active) continue;
    a.x += a.vx;
    a.y += a.vy;
    const dx = a.x - cx;
    const dy = a.y - cy;
    if (dx * dx + dy * dy > cull2) pool.release(a);
  }
}

/** (x,y)를 맞힌 화살과 그것이 든 풀. 없으면 null.
 *
 *  **화살 하나를 지목해서** 돌려주는 이유: 쉴드가 막을 때 그 한 발만 부숴야 한다.
 *  안 부수면 겹친 채로 다음 tick에 또 맞아, 여러 겹을 쌓아 뒀어도 한순간에 다 날아간다.
 *  ⚠️ 풀을 넘기는 **순서가 결과를 정한다.** 여러 발이 동시에 겹쳤을 때 어느 것이
 *     부서지는지가 달라지므로, 부르는 쪽은 순서를 마음대로 바꾸면 안 된다. */
export function findHit(
  pools: readonly ArrowPool[],
  x: number,
  y: number,
): { arrow: Arrow; pool: ArrowPool } | null {
  const reach = jungnimConfig.playerRadius + jungnimConfig.arrowRadius;
  const reach2 = reach * reach;
  for (const pool of pools) {
    for (const a of pool.items) {
      if (!a.active) continue;
      const dx = x - a.x;
      const dy = y - a.y;
      if (dx * dx + dy * dy <= reach2) return { arrow: a, pool };
    }
  }
  return null;
}

/** (x,y) 반경 안의 화살을 지운다(정화).
 *  ⚠️ 부르는 쪽이 **자기 화면의 풀만** 넘긴다. 공통 풀을 지우는 건 로컬에서만 일어나는
 *     일이라, 나를 관전 중인 사람 화면엔 그 화살이 남는다(config.item.purge 주석). */
export function clearArrowsNear(pools: readonly ArrowPool[], x: number, y: number, radius: number): void {
  const radius2 = radius * radius;
  for (const pool of pools) {
    for (const arrow of pool.items) {
      if (!arrow.active) continue;
      const dx = x - arrow.x;
      const dy = y - arrow.y;
      if (dx * dx + dy * dy <= radius2) pool.release(arrow);
    }
  }
}

/** 점을 원형 경기장 안으로 끌어당긴다. 중심에서 (반지름 - 플레이어반지름)보다 멀면
 *  그 경계 원 위로 되돌린다. 부수효과는 넘긴 점의 좌표에 국한된다. */
export function clampToArena(p: { x: number; y: number }): void {
  const { cx, cy, radius } = jungnimConfig.arena;
  const maxDist = radius - jungnimConfig.playerRadius;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > maxDist && dist > 0) {
    p.x = cx + (dx / dist) * maxDist;
    p.y = cy + (dy / dist) * maxDist;
  }
}
