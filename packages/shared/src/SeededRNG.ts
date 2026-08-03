/* ============================================================
   SeededRNG — 시드 기반 결정론 난수 (mulberry32)
   ------------------------------------------------------------
   결정론 불변식 #1: 게임 로직은 Math.random()을 쓰지 않는다.
   같은 시드로 초기화하면 항상 같은 난수열이 나온다.

   ⚠️ 이 인스턴스는 "게임 결과에 영향을 주는" 난수 전용이다.
   파티클·화면 흔들림 같은 순수 시각 효과는 이걸 건드리면 안 된다
   (next() 호출 횟수가 어긋나면 클라이언트마다 난수열이 틀어진다).
   ============================================================ */

export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0; // 부호 없는 32비트로 고정
  }

  /** 0 이상 1 미만. 같은 state면 항상 같은 다음 값. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) 범위 실수. */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [0, n) 범위 정수. */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** 배열에서 하나 무작위 선택. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}
