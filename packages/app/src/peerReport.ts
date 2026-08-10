/* ============================================================
   peerReport — 내 상태를 남들에게 알리는 0.1초 루프
   ------------------------------------------------------------
   판정이 아니라 **중계**다. 여기서 보내는 것이 유실돼도 게임 진행은 갈리지 않는다
   (내 판은 내 화면에서 이미 다 일어났다). 대신 남의 관전 화면이 그만큼 늙는다.

   싣는 것 셋:
   - 관전 신호(px·py) — 게임이 정한 숫자 둘. 좌표일 수도 진척도일 수도 있다(SpectateSignal).
     ⚠️ 내부에서는 a·b이고 wire에서만 px·py다. 갈아 끼우는 자리는 여기와 peerViews의
        applySnapshot 둘뿐이다 — wire 이름을 바꾸려면 서버 배포를 맞춰야 해서 남겨 뒀다.
   - ev — 게임이 낸 시각 이벤트. 있을 때만 붙인다. 서버는 뜻을 모른 채 한 번 중계한다.
   - sc — 지금까지의 기록. ⚠️ **이게 없으면 서버가 지어낸다.** 판이 끝나면 player_died가
     최종값을 내지만 연결이 끊기면 그게 안 오고, 서버는 그때 쓸 값이 필요하다
     (Room.disconnectMember 주석 — 예전에 여기서 80초가 4826점으로 찍혔다).
   ============================================================ */

import type { NetClient } from "@arcade/core";
import type { GameSession } from "./GameSession";

/** 보고 주기(ms). 서버 스냅샷도 10Hz라 더 자주 보내 봐야 다음 스냅샷을 기다릴 뿐이다. */
export const POSITION_SEND_MS = 100;

/** 보고 루프를 켠다. `active`가 false를 주는 동안(연습·대기·관전)은 조용하다
 *  — 연습에는 내 위치를 볼 남이 없고, 관전 중에 보내면 죽은 사람이 계속 살아 있는 것처럼 보인다. */
export function startPeerReport(net: NetClient, session: GameSession, active: () => boolean): void {
  window.setInterval(() => {
    if (!active()) return;
    const signal = session.getPosition();
    if (!signal) return;
    const ev = session.takePeerEvent();
    const sc = session.getScore();
    net.send({
      type: "player_state",
      px: signal.a,
      py: signal.b,
      ...(ev === null ? {} : { ev }),
      ...(sc === null ? {} : { sc: Math.max(0, Math.floor(sc)) }),
    });
  }, POSITION_SEND_MS);
}
