/* ============================================================
   RoomObject — 방 하나 = Durable Object 하나 (이식 2단계: 에코만)
   ------------------------------------------------------------
   기존 서버의 `RoomManager`가 방을 Map에 들고 있던 자리를 대신한다.
   방 코드로 `idFromName(code)` 하면 전 세계에서 **같은 오브젝트 하나**로
   라우팅되므로, "서버 머신은 반드시 1대"라는 제약이 사라진다. (DESIGN 10절)

   ⚠️ Hibernation API를 쓴다 (`ctx.acceptWebSocket`).
      `server.accept()`를 쓰면 연결이 살아있는 내내 duration 과금이 붙는다.
      대신 하이버네이션되면 **이 클래스의 메모리 필드가 날아간다** —
      방 상태는 3단계에서 `ctx.storage`에 넣는다. 지금은 상태가 없어 무해하다.

   지금은 받은 걸 돌려주기만 한다. 방 로직은 3단계.
   ============================================================ */

export class RoomObject {
  /** env는 아직 쓸 바인딩이 없어 받지 않는다. 필요해지면 두 번째 인자로 추가. */
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // WebSocketPair: [클라에게 돌려줄 쪽, 서버가 들고 있을 쪽]
    const { 0: client, 1: server } = new WebSocketPair();

    // accept()가 아니라 이것. 런타임이 소켓을 대신 붙들어 주므로
    // 유휴 상태에서 오브젝트가 메모리에서 내려가도 연결이 끊기지 않는다.
    this.ctx.acceptWebSocket(server);

    // 기존 서버가 연결 직후 보내던 welcome과 같은 자리. 지금은 id 발급 없이
    // 서버→클라 푸시가 되는지만 확인한다(3단계에서 진짜 welcome으로).
    server.send(JSON.stringify({ type: "hello", connected: this.ctx.getWebSockets().length }));

    return new Response(null, { status: 101, webSocket: client });
  }

  /** 하이버네이션에서 깨어나 메시지를 받는 진입점.
   *  기존 `socket.on("message", ...)`에 대응한다. */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const text = typeof message === "string" ? message : "(binary)";
    ws.send(JSON.stringify({ type: "echo", received: text }));
  }

  /** 기존 `socket.on("close", ...)`에 대응. 3단계에서 여기에 handleLeave가 붙는다.
   *
   *  ⚠️ 여기서 `ws.close()`를 부르면 안 된다. 이 콜백은 소켓이 **이미 닫힌 뒤**에
   *     불리므로 또 닫으려 하면 예외가 난다(로컬 검증에서 실제로 3번 터졌다).
   *     런타임이 정리를 끝낸 상태라 우리는 방 상태만 손보면 된다. */
  webSocketClose(): void {
    // 3단계: 이 자리에 나간 사람 처리(handleLeave)가 들어온다.
  }
}
