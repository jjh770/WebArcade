/* ============================================================
   RoomObject — 방 하나 = Durable Object 하나
   ------------------------------------------------------------
   기존 서버의 `RoomManager`가 방을 Map에 들고 있던 자리를 대신한다.
   방 코드로 `idFromName(code)` 하면 전 세계에서 **같은 오브젝트 하나**로
   라우팅되므로, "서버 머신은 반드시 1대"라는 제약이 사라진다. (DESIGN 10절)

   ⚠️ Hibernation API를 쓴다 (`ctx.acceptWebSocket`).
      `server.accept()`를 쓰면 연결이 살아있는 내내 duration 과금이 붙는다.
      대신 하이버네이션되면 **이 클래스의 메모리 필드가 날아간다** —
      그래서 방 정보는 반드시 `ctx.storage`에 있어야 하고, 메모리 필드는
      스토리지의 캐시로만 취급한다.

   ⚠️ "없는 방"이라는 개념: `idFromName(code)`는 코드가 뭐든 **항상** 스텁을
      돌려준다. 기존 `RoomManager.getRoom()`처럼 undefined가 나오지 않는다.
      그래서 스토리지에 방 레코드가 있는지로 존재 여부를 판단한다.

   현재 단계: 방 존재 여부와 코드 발급까지. 멤버·시드·순위는 다음 단계.
   ============================================================ */

const ROOM_KEY = "room";

/** 스토리지에 저장되는 방 레코드. 멤버 목록은 다음 단계에서 추가된다. */
type RoomRecord = {
  code: string;
  gameId: string;
  createdAt: number;
};

export class RoomObject {
  /** 스토리지의 캐시. 하이버네이션에서 깨면 비어 있으므로 생성자에서 되살린다. */
  private room: RoomRecord | null = null;

  constructor(private readonly ctx: DurableObjectState) {
    // blockConcurrencyWhile: 이 안의 작업이 끝나기 전에는 어떤 요청도 처리되지 않는다.
    // 하이버네이션에서 깨어난 직후 빈 상태로 요청을 받는 사고를 막는 유일한 장치다.
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomRecord>(ROOM_KEY)) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/claim") return this.claim(url);
    if (url.pathname === "/ws") return this.connect(request);
    return new Response("Not Found", { status: 404 });
  }

  /** 이 코드를 이 방이 선점한다. 이미 쓰이고 있으면 409 —
   *  Worker가 그걸 보고 다른 코드로 재시도한다(기존의 코드 충돌 검사 대체). */
  private async claim(url: URL): Promise<Response> {
    if (this.room) return new Response("taken", { status: 409 });

    const record: RoomRecord = {
      code: url.searchParams.get("code") ?? "",
      gameId: url.searchParams.get("gameId") ?? "",
      createdAt: Date.now(),
    };
    // 메모리보다 스토리지가 먼저다 — 쓰기가 실패하면 방이 있다고 착각하면 안 된다.
    await this.ctx.storage.put(ROOM_KEY, record);
    this.room = record;
    return Response.json({ code: record.code, gameId: record.gameId });
  }

  private connect(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // WebSocketPair: [클라에게 돌려줄 쪽, 서버가 들고 있을 쪽]
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    if (!this.room) {
      // 없는 방이다. HTTP 404로 끊지 않고 **기존 서버와 같은 문구**를 WS로 보낸 뒤 닫는다
      // — 클라의 에러 표시 경로를 그대로 쓰기 위해.
      server.send(JSON.stringify({ type: "error", reason: "방을 찾을 수 없습니다." }));
      server.close(1000, "room not found");
      return new Response(null, { status: 101, webSocket: client });
    }

    // 기존 서버가 연결 직후 보내던 welcome과 같은 자리.
    server.send(JSON.stringify({ type: "welcome", id: crypto.randomUUID() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 하이버네이션에서 깨어나 메시지를 받는 진입점.
   *  기존 `socket.on("message", ...)`에 대응한다.
   *  다음 단계에서 parseClientMessage + 방 로직이 여기 붙는다. */
  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
    // 아직 처리할 메시지가 없다.
  }

  /** 기존 `socket.on("close", ...)`에 대응. 다음 단계에서 handleLeave가 붙는다.
   *
   *  ⚠️ 여기서 `ws.close()`를 부르면 안 된다. 이 콜백은 소켓이 **이미 닫힌 뒤**에
   *     불리므로 또 닫으려 하면 예외가 난다(로컬 검증에서 실제로 3번 터졌다).
   *     런타임이 정리를 끝낸 상태라 우리는 방 상태만 손보면 된다. */
  webSocketClose(): void {
    // 다음 단계: 이 자리에 나간 사람 처리(handleLeave)가 들어온다.
  }
}
