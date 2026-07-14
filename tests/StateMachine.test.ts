import { describe, expect, it, vi } from "vitest";
import { StateMachine, type TransitionTable } from "../packages/core/src/StateMachine";

type State = "ready" | "playing" | "result";
type Event = "start" | "finish";

describe("StateMachine", () => {
  const table = {
    ready: { start: "playing" },
    playing: { finish: "result" },
  } satisfies TransitionTable<State, Event>;

  it("허용된 전이만 수행하고 전이 정보를 알린다", () => {
    const listener = vi.fn();
    const machine = new StateMachine<State, Event>("ready", table, listener);
    expect(machine.can("start")).toBe(true);
    expect(machine.transition("start")).toBe("playing");
    expect(listener).toHaveBeenCalledWith({ from: "ready", event: "start", to: "playing" });
  });

  it("정의되지 않은 전이를 거절한다", () => {
    const machine = new StateMachine<State, Event>("ready", table);
    expect(machine.can("finish")).toBe(false);
    expect(() => machine.transition("finish")).toThrow("허용되지 않은 상태 전이");
  });
});
