/* ============================================================
   obstacles — 커브 피버 장애물 도형과 공용 판정
   ------------------------------------------------------------
   장애물을 선분만이 아니라 여러 도형으로 넓힌다. 충돌·스폰안전·탐침·렌더가
   전부 이 타입 하나를 통해 도형 종류를 구분한다(태그 유니온).

   - segment: 선분 벽(테두리처럼 얇은 벽). 붙거나 떠 있는 조각.
   - circle : 꽉 찬 기둥. 원 안 전체가 죽음 지대라 "닿으면 죽음".
   - polygon: 속 빈 다각형. **윤곽선만** 벽이라 안으로 들어갔다 나올 수 있다.
              변을 선분으로 쪼개 판정한다(pts = [x0,y0,x1,y1,...] 닫힌 고리).
   ============================================================ */

import type { IRenderer } from "@arcade/shared";

export type Obstacle =
  | { kind: "segment"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "polygon"; pts: number[] };

/** 다각형의 각 변에 콜백을 돌린다(마지막 꼭짓점 → 첫 꼭짓점도 닫는다). */
function forEachEdge(pts: number[], fn: (x1: number, y1: number, x2: number, y2: number) => void): void {
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    fn(pts[i * 2]!, pts[i * 2 + 1]!, pts[j * 2]!, pts[j * 2 + 1]!);
  }
}

/** 반지름 pad의 원(=플레이어 머리)이 장애물 몸체와 겹치는가.
 *  선분 몸체는 두께 segmentHalf의 얇은 벽, 원 몸체는 꽉 찬 원판이다. */
export function obstacleBlocks(ob: Obstacle, px: number, py: number, pad: number, segmentHalf: number): boolean {
  const reach = segmentHalf + pad;
  const reach2 = reach * reach;
  if (ob.kind === "circle") {
    const dx = px - ob.cx;
    const dy = py - ob.cy;
    const cr = ob.r + pad;
    return dx * dx + dy * dy < cr * cr;
  }
  if (ob.kind === "polygon") {
    let hit = false;
    forEachEdge(ob.pts, (x1, y1, x2, y2) => {
      if (!hit && segPointDist2(px, py, x1, y1, x2, y2) < reach2) hit = true;
    });
    return hit;
  }
  return segPointDist2(px, py, ob.x1, ob.y1, ob.x2, ob.y2) < reach2;
}

/** 점에서 장애물 몸체 표면(선/윤곽선)까지의 거리. 원은 안이면 음수. 스폰 안전 판정에 쓴다.
 *  다각형은 속이 비어 윤곽선까지 거리다 — 안에 있어도 양수라, 스폰이 다각형 안에
 *  갇히지 않도록 spawnClearance를 다각형 반지름보다 크게 둔다(config 참조). */
export function obstacleClearance(ob: Obstacle, px: number, py: number, segmentHalf: number): number {
  if (ob.kind === "circle") {
    return Math.hypot(px - ob.cx, py - ob.cy) - ob.r;
  }
  if (ob.kind === "polygon") {
    let min = Infinity;
    forEachEdge(ob.pts, (x1, y1, x2, y2) => {
      const d = segPointDist2(px, py, x1, y1, x2, y2);
      if (d < min) min = d;
    });
    return Math.sqrt(min) - segmentHalf;
  }
  return Math.sqrt(segPointDist2(px, py, ob.x1, ob.y1, ob.x2, ob.y2)) - segmentHalf;
}

export function drawObstacle(r: IRenderer, ob: Obstacle, color: string, segmentWidth: number): void {
  if (ob.kind === "circle") r.circle(ob.cx, ob.cy, ob.r, color);
  else if (ob.kind === "polygon") forEachEdge(ob.pts, (x1, y1, x2, y2) => r.line(x1, y1, x2, y2, color, segmentWidth));
  else r.line(ob.x1, ob.y1, ob.x2, ob.y2, color, segmentWidth);
}

/** 점 (px,py)에서 선분 (x1,y1)-(x2,y2)까지 거리의 제곱. sqrt 회피용. */
export function segPointDist2(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}
