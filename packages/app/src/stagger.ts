/* ============================================================
   stagger — 목록 행이 순서대로 들어오게 하는 계산부
   ------------------------------------------------------------
   실제 모션은 CSS(.enter + --i)가 낸다. 여기서 정하는 건 둘뿐이다.
   - 누구를 애니메이션할 것인가 (대기실은 새로 들어온 사람만)
   - 몇 번째로 들여보낼 것인가 (지연이 무한정 길어지지 않게 상한)
   순수 계산이라 DOM 없이 테스트한다. UI_MOTION.md "목록 stagger" 참조.
   ============================================================ */

/** 지연을 곱할 인덱스의 상한. 20명이 모여도 마지막 행이 1초 뒤에 뜨면 안 된다. */
export const STAGGER_MAX_INDEX = 7;

/** 행에 넘길 순서값. 상한을 넘으면 뒤쪽은 다 같은 타이밍에 들어온다. */
export function staggerIndex(order: number): number {
  return Math.min(order, STAGGER_MAX_INDEX);
}

/** 이번 목록에서 처음 보는 id만 고른다.
 *  나간 사람은 previous에 남기지 않는 쪽이 호출자 책임이며, 그래야 재입장이
 *  다시 "새로 들어온 사람"으로 읽힌다. 목록 전체를 매번 애니메이션하면
 *  누가 새로 왔는지 알 수 없어진다(UI_MOTION.md 대기실). */
export function newcomers(previous: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  return new Set(ids.filter((id) => !previous.has(id)));
}
