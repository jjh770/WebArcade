import type { TransitionTable } from "@arcade/core";

export type AppState =
  | "nickname" | "main" | "gamelist" | "lobby" | "ready" | "countdown"
  | "playing" | "dying" | "deadResult" | "spectating" | "result"
  | "notice" | "about" | "community" | "ranking" | "options";

export type AppEvent =
  | "nickname_submit" | "open_games" | "back_main" | "select_game" | "back_games"
  | "room_joined" | "start_solo" | "game_start" | "countdown_done" | "local_death" | "keep_result"
  | "watch" | "game_over" | "return_ready" | "leave_room"
  | "nav_notice" | "nav_about" | "nav_community" | "nav_ranking" | "nav_options"
  | "nav_game_main" | "nav_game_nickname" | "change_nickname";

/** 읽을거리·설정처럼 판 밖에서 오가는 화면들. 어디서든 서로 넘나들 수 있다.
 *  ⚠️ 옵션도 여기 있다 — 소리 설정은 방에 들어가기 전에도 정할 수 있어야 한다.
 *     다만 **방에 있는 동안은** navTo가 막는다(FSM이 아니라 거기서 막는 이유는
 *     navigation.ts 머리말 참조). */
const CONTENT_TRANSITIONS = {
  nav_notice: "notice",
  nav_about: "about",
  nav_community: "community",
  nav_ranking: "ranking",
  nav_options: "options",
} as const;

export const APP_TRANSITIONS = {
  nickname: { nickname_submit: "main", nav_game_nickname: "nickname", ...CONTENT_TRANSITIONS },
  // change_nickname: 이름을 정한 뒤에도 그 화면으로 되돌아가는 유일한 길. 되돌아간 자리에서
  // 입장을 누르면 nickname_submit이 다시 main으로 데려오므로 새 길은 하나면 된다.
  main: { open_games: "gamelist", change_nickname: "nickname", nav_game_main: "main", ...CONTENT_TRANSITIONS },
  gamelist: { back_main: "main", select_game: "lobby", ...CONTENT_TRANSITIONS },
  // start_solo: 서버 없이 로컬 시드로 플레이(연습). 방은 안 거치지만 카운트다운은 거친다
  // (멀티는 서버시각 기준, 솔로는 로컬시각 기준 — 둘 다 countdown 상태를 지난다).
  lobby: { back_games: "gamelist", room_joined: "ready", start_solo: "countdown", ...CONTENT_TRANSITIONS },
  ready: { game_start: "countdown", leave_room: "lobby" },
  countdown: { countdown_done: "playing" },
  // 사망 → dying(화면 낙하 연출) → 자동으로 관전(watch) 또는 결과(관전할 남이 없을 때 keep_result).
  // 선택 화면은 없앴다 — 죽으면 화면이 떨어진 뒤 살아있는 남의 화면으로 슬라이드된다.
  playing: { local_death: "dying", game_over: "result" },
  dying: { keep_result: "deadResult", watch: "spectating", game_over: "result" },
  deadResult: { game_over: "result" },
  spectating: { game_over: "result" },
  // nav_ranking: 결과에서 전체 순위표로 빠지는 길. **혼자 플레이에서만** 쓰인다 —
  // 멀티에서는 버튼이 숨고 navTo가 방에 있는 동안을 막는다(방을 두고 나가면 안 되므로).
  result: { return_ready: "ready", start_solo: "countdown", leave_room: "lobby", nav_ranking: "ranking" },
  notice: { ...CONTENT_TRANSITIONS, nav_game_main: "main", nav_game_nickname: "nickname" },
  about: { ...CONTENT_TRANSITIONS, nav_game_main: "main", nav_game_nickname: "nickname" },
  community: { ...CONTENT_TRANSITIONS, nav_game_main: "main", nav_game_nickname: "nickname" },
  ranking: { ...CONTENT_TRANSITIONS, nav_game_main: "main", nav_game_nickname: "nickname" },
  options: { ...CONTENT_TRANSITIONS, nav_game_main: "main", nav_game_nickname: "nickname" },
} satisfies TransitionTable<AppState, AppEvent>;

/** 판이 도는 동안의 상태들. 여기 있는 것은 사이트 화면(카드)이 아니라 **게임판 위**에 산다.
 *  ⚠️ 목록을 `as const`로 두는 이유는 타입도 여기서 나오기 때문이다 — 화면 이름 목록이
 *     이것의 여집합으로 파생되므로(AppView의 `ScreenName`), 둘을 손으로 맞출 일이 없다. */
export const PLAY_STATE_NAMES = ["playing", "dying", "deadResult", "spectating", "result"] as const;
export type PlayState = (typeof PLAY_STATE_NAMES)[number];

export const PLAY_STATES: ReadonlySet<AppState> = new Set(PLAY_STATE_NAMES);

/** `PLAY_STATES.has()`와 같은 것을 묻되 **타입까지 좁힌다.** Set 검사만으로는 좁혀지지
 *  않아서, 이걸 쓰기 전에는 화면 이름으로 넘길 때 `as`로 우겨 넣고 있었다. */
export function isPlayState(state: AppState): state is PlayState {
  return PLAY_STATES.has(state);
}

/* 키 하나가 무슨 뜻인지는 여기 없다 — shortcuts.ts가 화면 밖 키를 전부 맡는다.
   여기는 화면과 화면 사이의 길만 정한다. */
