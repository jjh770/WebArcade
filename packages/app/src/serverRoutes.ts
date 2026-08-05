/* ============================================================
   serverRoutes — 서버가 보내온 메시지 하나를 앱의 행동으로
   ------------------------------------------------------------
   서버에서 오는 모든 것이 여기 한 번씩 지나간다. main에 있을 때는 이 switch가
   앱의 나머지 절반(버튼 배선·화면 전환·부트스트랩)과 한 파일에 섞여 있었고,
   무엇에 기대고 있는지가 **모듈 전역 변수라 보이지 않았다.**

   그래서 필요한 것을 인터페이스로 받아 적었다(ServerRouteDeps). 목록이 길면
   길다는 사실 자체가 정보다 — 지금 열 개다.

   ⚠️ 여기서 상태를 들고 있지 않는다. 내 신원도 방 정보도 main이 소유하고,
      이 파일은 읽고 쓰는 통로만 받는다. 서버 메시지 처리에 자기 기억이 생기면
      "화면이 아는 것"과 "라우터가 아는 것"이 갈리기 시작한다.
   ============================================================ */

import type { RankEntry, ServerMessage } from "@arcade/shared";
import type { AppEvent, AppState } from "./AppFlow";
import { renderReady, setAliveHud, toast } from "./AppView";
import { play } from "./audio";
import { isGameId, type GameId } from "./GameRegistry";
import type { GameSession } from "./GameSession";
import { debuffFx } from "./screenFx";

export type ServerRouteDeps = {
  session: GameSession;
  /** 지금 앱 상태(FSM). 같은 메시지도 어느 화면에서 받았는지에 따라 다르게 처리된다. */
  state: () => AppState;
  transition: (event: AppEvent) => boolean;
  /** 내 신원. welcome이 정하고 그 뒤로는 "이게 나인가"를 가리는 데만 쓴다. */
  myId: () => string | null;
  setMyId: (id: string) => void;
  /** 내가 방장인가 — 결과 화면에서 다음 판을 시작할 수 있는 사람이 갈린다. */
  setHost: (isHost: boolean) => void;
  /** 방이 알려 준 게임으로 맞춘다(남이 만든 방에 코드로 들어왔을 때). */
  setGame: (id: GameId) => void;
  /** 지금 들어와 있는 방의 코드. 주소에 남는 값이라 화면이 아니라 앱이 소유한다. */
  setRoomCode: (code: string) => void;
  /** 결과 화면이 떠 있으면 지금 상태로 다시 그린다(아니면 아무 일도 안 한다).
   *  방장이 바뀌거나 방 상태가 다시 와도 "다시 하기"의 주인이 맞게 남는다. */
  refreshResult: () => void;
  startCountdown: (seed: number, startTime: number, gameId: string) => void;
  showResult: (ranks: readonly RankEntry[]) => void;
};

export function createServerRouter(deps: ServerRouteDeps): (message: ServerMessage) => void {
  return (message: ServerMessage): void => {
    switch (message.type) {
      case "welcome":
        deps.setMyId(message.id);
        break;
      case "room_state": {
        const myId = deps.myId();
        deps.setHost(message.hostId === myId);
        deps.session.setRoster(message.players, myId);
        if (isGameId(message.gameId)) deps.setGame(message.gameId);
        renderReady(message.code, message.players, message.hostId, myId);
        deps.setRoomCode(message.code);
        if (message.state === "waiting") {
          if (deps.state() === "lobby") deps.transition("room_joined");
          else if (deps.state() === "result") deps.transition("return_ready");
        } else {
          // 판이 도는 방에 상태만 다시 온 경우 — 결과를 보고 있었다면 그 화면을 갱신한다.
          deps.refreshResult();
        }
        break;
      }
      case "game_start":
        deps.startCountdown(message.seed, message.startTime, message.gameId);
        break;
      case "peer_snapshot":
        deps.session.applySnapshot(message.peers);
        break;
      case "peer_died":
        deps.session.markPeerDead(message.id);
        break;
      case "effect_hit":
        // 누군가 스릴 게이지를 채워 나를 조준해 방해 디버프를 쐈다. 살아서 플레이 중일 때만
        // 게임에 적용하고, 같은 조건에서 화면 연출(배너 + 시각 디버프)도 함께 건다.
        // 소리는 게임 계약을 안 거친다 — 이건 네트워크에서 온 사건이라 앱이 이미 안다.
        if (deps.session.applyEffect(message.kind, message.durationMs)) {
          play("hit");
          debuffFx(message.kind, message.durationMs);
        }
        break;
      case "ranking_update":
        setAliveHud(`생존 ${message.alive} / ${message.ranks.length}`);
        break;
      case "game_over":
        deps.showResult(message.finalRanks);
        break;
      case "host_changed":
        deps.setHost(message.newHostId === deps.myId());
        deps.refreshResult();
        break;
      case "error":
        toast(message.reason);
        break;
      case "time_sync_response":
        // 시각 동기화는 NetClient가 스스로 처리한다(왕복 지연 보정). 앱이 할 일은 없다.
        break;
    }
  };
}
