import type { TransitionTable } from "@arcade/core";

export type AppState =
  | "nickname" | "main" | "gamelist" | "lobby" | "ready" | "countdown"
  | "playing" | "dying" | "deadResult" | "spectating" | "result"
  | "notice" | "about" | "community";

export type AppEvent =
  | "nickname_submit" | "open_games" | "back_main" | "select_game" | "back_games"
  | "room_joined" | "start_solo" | "game_start" | "countdown_done" | "local_death" | "keep_result"
  | "watch" | "game_over" | "return_ready" | "leave_room"
  | "nav_notice" | "nav_about" | "nav_community" | "nav_game_main" | "nav_game_nickname";

const CONTENT_TRANSITIONS = {
  nav_notice: "notice",
  nav_about: "about",
  nav_community: "community",
} as const;

export const APP_TRANSITIONS = {
  nickname: { nickname_submit: "main", nav_game_nickname: "nickname", ...CONTENT_TRANSITIONS },
  main: { open_games: "gamelist", nav_game_main: "main", ...CONTENT_TRANSITIONS },
  gamelist: { back_main: "main", select_game: "lobby", ...CONTENT_TRANSITIONS },
  // start_solo: 서버 없이 로컬 시드로 바로 플레이(연습). 방·카운트다운을 거치지 않는다.
  lobby: { back_games: "gamelist", room_joined: "ready", start_solo: "playing", ...CONTENT_TRANSITIONS },
  ready: { game_start: "countdown", leave_room: "lobby" },
  countdown: { countdown_done: "playing" },
  // 사망 → dying(화면 낙하 연출) → 자동으로 관전(watch) 또는 결과(관전할 남이 없을 때 keep_result).
  // 선택 화면은 없앴다 — 죽으면 화면이 떨어진 뒤 살아있는 남의 화면으로 슬라이드된다.
  playing: { local_death: "dying", game_over: "result" },
  dying: { keep_result: "deadResult", watch: "spectating", game_over: "result" },
  deadResult: { game_over: "result" },
  spectating: { game_over: "result" },
  result: { return_ready: "ready", start_solo: "playing", leave_room: "lobby" },
  notice: { ...CONTENT_TRANSITIONS, nav_game_main: "main", nav_game_nickname: "nickname" },
  about: { ...CONTENT_TRANSITIONS, nav_game_main: "main", nav_game_nickname: "nickname" },
  community: { ...CONTENT_TRANSITIONS, nav_game_main: "main", nav_game_nickname: "nickname" },
} satisfies TransitionTable<AppState, AppEvent>;

export const PLAY_STATES: ReadonlySet<AppState> = new Set([
  "playing", "dying", "deadResult", "spectating", "result",
]);
