/* ============================================================
   NetClient — 타입 안전한 WebSocket 클라이언트 (core)
   ------------------------------------------------------------
   서버와 주고받는 메시지를 shared의 프로토콜 타입으로 좁힌다.
   core는 게임을 모른다 — NetClient도 게임 개념 없이 메시지만 중계한다.
   (브라우저 WebSocket 사용. 게임 로직과 무관하므로 결정론 불변식과 무관.)
   ============================================================ */

import type { ClientMessage, ServerMessage } from "@arcade/shared";

export class NetClient {
  private ws: WebSocket | null = null;
  private readonly handlers = new Set<(msg: ServerMessage) => void>();

  /** 서버에 연결. open되면 resolve, 실패하면 reject. */
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`WebSocket 연결 실패: ${url}`));
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMessage;
        } catch {
          return; // 파싱 불가 메시지는 무시.
        }
        for (const h of this.handlers) h(msg);
      };
    });
  }

  /** 서버로 메시지 전송. 연결 전이면 무시. */
  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** 서버 메시지 구독. 반환된 함수를 호출하면 구독 해제. */
  onMessage(handler: (msg: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
  }
}
