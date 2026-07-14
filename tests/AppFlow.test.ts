import { describe, expect, it } from "vitest";
import { StateMachine } from "../packages/core/src/StateMachine";
import { APP_TRANSITIONS, type AppEvent, type AppState } from "../packages/app/src/AppFlow";

function createFlow(): StateMachine<AppState, AppEvent> {
  return new StateMachine<AppState, AppEvent>("nickname", APP_TRANSITIONS);
}

function advance(machine: StateMachine<AppState, AppEvent>, events: readonly AppEvent[]): void {
  for (const event of events) machine.transition(event);
}

describe("앱 FSM", () => {
  it("사망 결과 유지 후 최종 결과와 대기실 복귀를 수행한다", () => {
    const flow = createFlow();
    advance(flow, [
      "nickname_submit", "open_games", "select_game", "room_joined", "game_start",
      "countdown_done", "local_death", "keep_result", "game_over", "return_ready",
    ]);
    expect(flow.state).toBe("ready");
  });

  it("사망 후 관전 분기를 수행한다", () => {
    const flow = createFlow();
    advance(flow, [
      "nickname_submit", "open_games", "select_game", "room_joined", "game_start",
      "countdown_done", "local_death", "watch",
    ]);
    expect(flow.state).toBe("spectating");
    flow.transition("game_over");
    expect(flow.state).toBe("result");
  });

  it("결과 중 일반 room_joined 전이는 허용하지 않는다", () => {
    const flow = createFlow();
    advance(flow, [
      "nickname_submit", "open_games", "select_game", "room_joined", "game_start",
      "countdown_done", "game_over",
    ]);
    expect(flow.can("room_joined")).toBe(false);
    expect(flow.state).toBe("result");
  });
});
