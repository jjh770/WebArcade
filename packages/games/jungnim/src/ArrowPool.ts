/* ============================================================
   ArrowPool — 화살 오브젝트 풀 (AGENTS.md 3절: 오브젝트 풀링)
   ------------------------------------------------------------
   대량 생성/소멸되는 화살을 매 프레임 new 하지 않고 재사용한다.
   GC 압력을 줄이는 것이 1차 목적이지만, 결정론과도 얽혀 있다:

   ⚠️ acquire/release가 tick 기반의 결정론적 순서로만 일어나야
   클라이언트마다 같은 풀 상태가 유지된다. 여기서는 free 인덱스
   스택을 쓰되, 이 스택을 만지는 호출(spawn=acquire, 화면 밖=release)이
   모두 tick·시드에서 파생되므로 순서가 재현 가능하다.
   ============================================================ */

/** 화살 하나. 위치·속도는 px 단위, 속도는 px/tick(고정 스텝). */
export class Arrow {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  active = false;
  /** 개인(플레이어 조준) 화살이면 true. 공통(시드) 화살은 false.
   *  렌더 색 구분 + 레이어 분리 확인용. 반납 시 반드시 false로 되돌린다. */
  personal = false;

  /** 풀 내 고정 인덱스(release 시 free 스택 복원용). */
  constructor(readonly index: number) {}
}

export class ArrowPool {
  /** 고정 크기 배열. 순회는 항상 인덱스 오름차순(결정론적). */
  readonly items: readonly Arrow[];
  /** 사용 가능한 인덱스 스택. pop=acquire, push=release. */
  private free: number[] = [];

  constructor(size: number) {
    const items: Arrow[] = [];
    for (let i = 0; i < size; i++) items.push(new Arrow(i));
    this.items = items;
    this.resetFreeList();
  }

  /** 비활성 화살 하나를 활성화해 반환. 풀 고갈 시 undefined(스폰을 건너뛴다). */
  acquire(): Arrow | undefined {
    const i = this.free.pop();
    if (i === undefined) return undefined;
    const a = this.items[i];
    a.active = true;
    return a;
  }

  /** 화살을 비활성화해 풀로 반납. personal 플래그도 반드시 초기화(재사용 누수 방지). */
  release(a: Arrow): void {
    if (!a.active) return;
    a.active = false;
    a.personal = false;
    this.free.push(a.index);
  }

  /** free 스택을 [size-1 … 0]으로 채워, pop이 0,1,2… 순서로 나오게 한다. */
  private resetFreeList(): void {
    this.free = [];
    for (let i = this.items.length - 1; i >= 0; i--) this.free.push(i);
  }
}
