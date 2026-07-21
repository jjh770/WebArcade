/* ============================================================
   NetClient — 타입 안전한 WebSocket 클라이언트 (core)
   ------------------------------------------------------------
   서버와 주고받는 메시지를 shared의 프로토콜 타입으로 좁힌다.
   core는 게임을 모른다 — NetClient도 게임 개념 없이 메시지만 중계한다.
   (브라우저 WebSocket 사용. 게임 로직과 무관하므로 결정론 불변식과 무관.)
   ============================================================ */

import type { ClientMessage, ServerMessage } from "@arcade/shared";
import {
  selectBestClockAnchor,
  serverNowFromAnchor,
  serverTimeToPerformance as convertServerTimeToPerformance,
  type ClockAnchor,
  type ClockSample,
} from "../ClockSync";

export class NetClient {
  private ws: WebSocket | null = null;
  private readonly handlers = new Set<(msg: ServerMessage) => void>();
  private readonly syncRequests = new Map<string, { sentAt: number; resolve: (sample: ClockSample) => void; reject: (error: Error) => void; timeout: number }>();
  private syncSequence = 0;
  private clockAnchor: ClockAnchor | null = null;

  /** 서버에 연결. open되면 resolve, 실패하면 reject.
   *
   *  ⚠️ 연결은 **방 단위**다. 방 하나가 서버 인스턴스 하나(Durable Object)라
   *     URL로 방이 정해지고, 붙은 뒤에는 다른 방으로 옮길 수 없다.
   *     방을 바꾸려면 close() 후 새 URL로 다시 connect 한다. */
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws?.close(); // 방을 옮기는 경우 이전 연결을 먼저 정리한다.
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.synchronizeClock().then(resolve, reject);
      };
      ws.onerror = () => reject(new Error(`WebSocket 연결 실패: ${url}`));
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMessage;
        } catch {
          return; // 파싱 불가 메시지는 무시.
        }
        if (msg.type === "time_sync_response") {
          this.handleTimeSync(msg.requestId, msg.serverTime);
          return;
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

  get isClockSynchronized(): boolean {
    return this.clockAnchor !== null;
  }

  getServerNow(): number {
    if (!this.clockAnchor) throw new Error("서버 시각이 아직 동기화되지 않았습니다.");
    return serverNowFromAnchor(this.clockAnchor, performance.now());
  }

  serverTimeToPerformance(serverTime: number): number {
    if (!this.clockAnchor) throw new Error("서버 시각이 아직 동기화되지 않았습니다.");
    return convertServerTimeToPerformance(this.clockAnchor, serverTime);
  }

  /** 서버 메시지 구독. 반환된 함수를 호출하면 구독 해제. */
  onMessage(handler: (msg: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.clockAnchor = null;
    // ⚠️ handlers는 지우지 않는다. 앱은 시작할 때 한 번 구독하고, 방을 드나들 때마다
    //    연결만 새로 맺는다 — 여기서 지우면 두 번째 방부터 메시지를 못 받는다.
    for (const pending of this.syncRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("WebSocket 연결이 종료되었습니다."));
    }
    this.syncRequests.clear();
  }


  private async synchronizeClock(): Promise<void> {
    const samples = await Promise.allSettled(Array.from({ length: 5 }, () => this.sampleClock()));
    const successful = samples
      .filter((result): result is PromiseFulfilledResult<ClockSample> => result.status === "fulfilled")
      .map((result) => result.value);
    if (successful.length === 0) throw new Error("서버 시각 동기화에 실패했습니다.");
    this.clockAnchor = selectBestClockAnchor(successful);
  }

  private sampleClock(): Promise<ClockSample> {
    return new Promise((resolve, reject) => {
      const requestId = `clock-${++this.syncSequence}`;
      const sentAt = performance.now();
      const timeout = window.setTimeout(() => {
        this.syncRequests.delete(requestId);
        reject(new Error("서버 시각 응답 시간 초과"));
      }, 1000);
      this.syncRequests.set(requestId, { sentAt, resolve, reject, timeout });
      this.send({ type: "time_sync_request", requestId });
    });
  }

  private handleTimeSync(requestId: string, serverTime: number): void {
    const pending = this.syncRequests.get(requestId);
    if (!pending) return;
    this.syncRequests.delete(requestId);
    clearTimeout(pending.timeout);
    const receivedAt = performance.now();
    const rtt = receivedAt - pending.sentAt;
    pending.resolve({ rtt, receivedAt, serverTimeAtReceipt: serverTime + rtt / 2 });
  }
}
