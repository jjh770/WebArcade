import { describe, expect, it } from "vitest";
import { StateMachine } from "../packages/core/src/StateMachine";
import { APP_TRANSITIONS, type AppEvent, type AppState } from "../packages/app/src/AppFlow";
import { hashFor } from "../packages/app/src/navigation";

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

  it("로비에서 방은 건너뛰되 카운트다운을 거쳐 플레이한다", () => {
    const flow = createFlow();
    advance(flow, [...toLobby, "start_solo"]);
    expect(flow.state).toBe("countdown"); // 솔로도 카운트다운을 지난다
    flow.transition("countdown_done");
    expect(flow.state).toBe("playing");
  });

  it("결과에서 새 라운드를 시작하면 카운트다운부터 다시 시작한다", () => {
    const flow = createFlow();
    advance(flow, [...toLobby, "start_solo", "countdown_done", "game_over"]);
    expect(flow.state).toBe("result");
    flow.transition("start_solo");
    expect(flow.state).toBe("countdown");
    flow.transition("countdown_done");
    expect(flow.state).toBe("playing");
  });

  it("결과에서 로비로 나갈 수 있다", () => {
    const flow = createFlow();
    advance(flow, [...toLobby, "start_solo", "countdown_done", "game_over", "leave_room"]);
    expect(flow.state).toBe("lobby");
  });

  it("플레이 중에는 연습을 다시 시작할 수 없다", () => {
    // 진행 중인 라운드를 버튼 하나로 갈아엎지 못하게 막는다.
    const flow = createFlow();
    advance(flow, [...toLobby, "start_solo", "countdown_done"]);
    expect(flow.state).toBe("playing");
    expect(flow.can("start_solo")).toBe(false);
  });

  it("대기실(멀티)에서는 연습으로 새지 않는다", () => {
    // 방에 사람들을 모아둔 채 혼자 연습으로 빠지면 방이 깨진다.
    const flow = createFlow();
    advance(flow, [...toLobby, "room_joined"]);
    expect(flow.state).toBe("ready");
    expect(flow.can("start_solo")).toBe(false);
  });

  it("순위 화면은 다른 읽을거리 화면과 오갈 수 있다", () => {
    const flow = createFlow();
    advance(flow, ["nickname_submit", "nav_ranking"]);
    expect(flow.state).toBe("ranking");
    flow.transition("nav_about");
    expect(flow.state).toBe("about");
    flow.transition("nav_ranking");
    expect(flow.state).toBe("ranking");
    flow.transition("nav_game_main");
    expect(flow.state).toBe("main");
  });

  it("결과 화면에서 전체 순위표로 갈 수 있다", () => {
    // 방금 낸 기록의 등수가 제일 궁금한 순간이다. (멀티는 버튼이 숨고 navTo가 막는다)
    const flow = createFlow();
    advance(flow, [...toLobby, "start_solo", "countdown_done", "game_over"]);
    expect(flow.state).toBe("result");
    flow.transition("nav_ranking");
    expect(flow.state).toBe("ranking");
  });

  it("플레이 중에는 순위를 열 수 없다 — 판이 사라진다", () => {
    const flow = createFlow();
    advance(flow, [...toLobby, "start_solo", "countdown_done"]);
    expect(flow.state).toBe("playing");
    expect(flow.can("nav_ranking")).toBe(false);
  });
});

/* 주소에 남는 해시. 주인이 둘(순위 화면·방 코드)이라 한 함수가 정한다.
   ⚠️ 예전에는 순위 화면만 알고 나머지 상태에서는 무조건 비웠다. 그래서 방에 들어가며
      붙은 방 코드가 바로 뒤의 화면 전이에 지워져, 주소를 복사해 친구에게 보내는 길이
      막혀 있었다(코드를 말로 부르는 길만 남았다). 그 사고를 여기서 못 박는다. */
describe("주소에 남는 해시", () => {
  it("순위 화면은 링크로 보낼 수 있다", () => {
    expect(hashFor("ranking", null)).toBe("#ranking");
  });

  it("방에 있는 동안은 방 코드가 남는다 — 주소만 보내면 친구가 그대로 들어온다", () => {
    for (const state of ["ready", "countdown", "playing", "spectating", "result"] as const) {
      expect(hashFor(state, "ABCD")).toBe("#ABCD");
    }
  });

  it("방을 나가면 비운다", () => {
    expect(hashFor("main", null)).toBe("");
    expect(hashFor("lobby", null)).toBe("");
  });

  it("둘 다면 순위 화면이 이긴다", () => {
    // 실제로는 겹치지 않는다(방에 있는 동안 순위표는 막혀 있다) — 순서를 정해 둘 뿐이다.
    expect(hashFor("ranking", "ABCD")).toBe("#ranking");
  });
});
