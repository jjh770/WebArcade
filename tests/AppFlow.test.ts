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
  it("사망하면 낙하(dying) 상태를 거친다 — 즉시 선택 화면이 아니다", () => {
    const flow = createFlow();
    advance(flow, [
      "nickname_submit", "open_games", "select_game", "room_joined", "game_start",
      "countdown_done", "local_death",
    ]);
    expect(flow.state).toBe("dying");
  });

  it("낙하 후 관전으로 자동 전환하고 최종 결과로 간다", () => {
    const flow = createFlow();
    advance(flow, [
      "nickname_submit", "open_games", "select_game", "room_joined", "game_start",
      "countdown_done", "local_death", "watch", // watch는 낙하 타이머가 자동으로 발생시킨다
    ]);
    expect(flow.state).toBe("spectating");
    flow.transition("game_over");
    expect(flow.state).toBe("result");
  });

  it("관전할 생존자가 없으면 낙하 후 결과를 기다린다", () => {
    const flow = createFlow();
    advance(flow, [
      "nickname_submit", "open_games", "select_game", "room_joined", "game_start",
      "countdown_done", "local_death", "keep_result", "game_over", "return_ready",
    ]);
    expect(flow.state).toBe("ready");
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

describe("연습(싱글) 모드 흐름", () => {
  const toLobby: readonly AppEvent[] = ["nickname_submit", "open_games", "select_game"];

  it("로비에서 방·카운트다운을 건너뛰고 바로 플레이한다", () => {
    const flow = createFlow();
    advance(flow, [...toLobby, "start_solo"]);
    expect(flow.state).toBe("playing");
  });

  it("결과에서 새 라운드를 바로 시작할 수 있다", () => {
    const flow = createFlow();
    advance(flow, [...toLobby, "start_solo", "game_over"]);
    expect(flow.state).toBe("result");
    flow.transition("start_solo");
    expect(flow.state).toBe("playing");
  });

  it("결과에서 로비로 나갈 수 있다", () => {
    const flow = createFlow();
    advance(flow, [...toLobby, "start_solo", "game_over", "leave_room"]);
    expect(flow.state).toBe("lobby");
  });

  it("플레이 중에는 연습을 다시 시작할 수 없다", () => {
    // 진행 중인 라운드를 버튼 하나로 갈아엎지 못하게 막는다.
    const flow = createFlow();
    advance(flow, [...toLobby, "start_solo"]);
    expect(flow.can("start_solo")).toBe(false);
  });

  it("대기실(멀티)에서는 연습으로 새지 않는다", () => {
    // 방에 사람들을 모아둔 채 혼자 연습으로 빠지면 방이 깨진다.
    const flow = createFlow();
    advance(flow, [...toLobby, "room_joined"]);
    expect(flow.state).toBe("ready");
    expect(flow.can("start_solo")).toBe(false);
  });
});
