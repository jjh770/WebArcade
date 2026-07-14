export type TransitionTable<TState extends string, TEvent extends string> = {
  readonly [S in TState]?: Partial<Record<TEvent, TState>>;
};

export type StateTransition<TState extends string, TEvent extends string> = {
  from: TState;
  event: TEvent;
  to: TState;
};

/**
 * 게임이나 화면 이름을 모르는 범용 유한 상태 머신.
 * 허용되지 않은 전이를 예외로 드러내 boolean 조합으로 생기는 숨은 상태를 막는다.
 */
export class StateMachine<TState extends string, TEvent extends string> {
  constructor(
    private current: TState,
    private readonly table: TransitionTable<TState, TEvent>,
    private readonly onTransition?: (transition: StateTransition<TState, TEvent>) => void,
  ) {}

  get state(): TState {
    return this.current;
  }

  can(event: TEvent): boolean {
    return this.table[this.current]?.[event] !== undefined;
  }

  transition(event: TEvent): TState {
    const next = this.table[this.current]?.[event];
    if (next === undefined) {
      throw new Error(`허용되지 않은 상태 전이: ${this.current} --${event}--> ?`);
    }
    const from = this.current;
    this.current = next;
    this.onTransition?.({ from, event, to: next });
    return next;
  }
}
