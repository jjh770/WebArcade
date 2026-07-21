/* 방 상태·검증 순수 로직 테스트.
   ⚠️ 대상은 `packages/edge`다 — 서버를 Cloudflare Workers로 이식하면서
      packages/server의 같은 파일들은 폐기된다(DESIGN 10절).
      전송 계층(WebSocket·DO) 테스트는 Workers 런타임에서 따로 돈다. */
import { describe, expect, it } from "vitest";
import { RankingService } from "../packages/edge/src/RankingService";
import { Room, ROOM_CAPACITY } from "../packages/edge/src/Room";
import { generateRoomCode } from "../packages/edge/src/roomCode";
import { parseClientMessage } from "../packages/edge/src/validation";

describe("Room", () => {
  it("정원과 방 상태를 지키고 연결 종료를 라운드 사망으로 보존한다", () => {
    const room = new Room("ABCD", "jungnim", 2);
    expect(room.addMember("a", "A")).toBe(true);
    expect(room.addMember("b", "B")).toBe(true);
    expect(room.addMember("c", "C")).toBe(false);

    room.startCountdown(1, 1000);
    expect(room.ensurePlaying(999)).toBe(false);
    expect(room.ensurePlaying(1100)).toBe(true);
    expect(room.disconnectMember("a", 1100).died).toBe(true);
    expect(room.markDied("b", 7)).toBe(true);

    const ranks = RankingService.computeRanks(room.getRankingMembers());
    expect(ranks.map((rank) => rank.id)).toEqual(["b", "a"]);
    expect(RankingService.aliveCount(room.getRankingMembers())).toBe(0);
  });

  it("위치를 받은 살아있는 연결만 스냅샷에 포함한다", () => {
    const room = new Room("ABCD", "jungnim", 2);
    room.addMember("a", "A");
    room.addMember("b", "B");
    room.startCountdown(1, 0);
    room.ensurePlaying(1);
    room.updatePosition("a", 10, 20);
    expect(room.getPeerSnapshot()).toEqual([{ id: "a", px: 10, py: 20 }]);
  });
});

describe("빈 방 유예 (호스트가 끊겨도 코드가 살아있다)", () => {
  const GRACE = 60_000;

  it("호스트가 나가도 방이 즉시 사라지지 않는다", () => {
    // 이 회귀가 실제로 터졌다: 호스트 소켓이 끊기자 방이 증발해,
    // 친구가 받은 코드에 "방을 찾을 수 없습니다"가 떴다.
    const room = new Room("ABCD", "jungnim", 32);
    room.addMember("host", "호스트");
    room.disconnectMember("host", 0);
    expect(room.isEmpty()).toBe(true);

    room.markEmpty(0);
    expect(room.isExpired(GRACE - 1, GRACE)).toBe(false);
  });

  it("유예 안에 돌아오면 방이 이어지고, 돌아온 사람이 호스트가 된다", () => {
    const room = new Room("ABCD", "jungnim", 32);
    room.addMember("host", "호스트");
    room.disconnectMember("host", 0);
    room.markEmpty(0);

    expect(room.addMember("host2", "호스트")).toBe(true); // 새로고침 후 복귀(새 연결 id)
    expect(room.hostId).toBe("host2");
    expect(room.emptySince).toBeNull(); // 유예 시계가 꺼진다
    expect(room.isExpired(GRACE * 10, GRACE)).toBe(false); // 사람이 있으면 영원히 안 만료
  });

  it("라운드 중 전원이 끊기면 대기 상태로 되돌려 재입장을 허용한다", () => {
    const room = new Room("ABCD", "jungnim", 32);
    room.addMember("host", "호스트");
    room.startCountdown(1, 0);
    room.disconnectMember("host", 0);
    room.markEmpty(0);

    expect(room.state).toBe("waiting"); // playing인 채로 두면 addMember가 거부한다
    expect(room.addMember("host2", "호스트")).toBe(true);
  });

  it("유예가 지나면 만료로 표시된다 — 죽은 방이 코드를 붙들지 않는다", () => {
    // 회수 자체(스토리지 삭제)는 DO의 alarm()이 하고 Workers 런타임 테스트에서 검증한다.
    // 여기서는 "언제 만료인가"라는 판단만 본다.
    const room = new Room("ABCD", "jungnim", 32);
    room.addMember("host", "호스트");
    room.disconnectMember("host", 0);
    room.markEmpty(0);

    expect(room.isExpired(GRACE - 1, GRACE)).toBe(false);
    expect(room.isExpired(GRACE, GRACE)).toBe(true);
  });

  it("사람이 있는 방은 절대 만료되지 않는다", () => {
    const room = new Room("ABCD", "jungnim", 32);
    room.addMember("host", "호스트");
    expect(room.emptySince).toBeNull();
    expect(room.isExpired(GRACE * 100, GRACE)).toBe(false);
  });
});

describe("방 상태 직렬화 (하이버네이션 복원 경로)", () => {
  it("snapshot→restore 왕복에서 멤버·라운드 상태가 보존된다", () => {
    // Durable Object가 잠들면 메모리가 날아간다. 이 왕복이 깨지면 깨어난 방이
    // 빈손이 되어 참가자가 통째로 사라진다.
    const room = new Room("ABCD", "jungnim", ROOM_CAPACITY);
    room.addMember("a", "가희");
    room.addMember("b", "종혁");
    room.startCountdown(4242, 9999);
    room.ensurePlaying(10_000);
    room.updatePosition("a", 12, 34);
    room.markDied("b", 77);

    const restored = Room.restore(room.snapshot(), ROOM_CAPACITY);

    expect(restored.code).toBe("ABCD");
    expect(restored.gameId).toBe("jungnim");
    expect(restored.state).toBe("playing");
    expect(restored.seed).toBe(4242);
    expect(restored.startTime).toBe(9999);
    expect(restored.hostId).toBe("a");
    expect(restored.getPeerSnapshot()).toEqual([{ id: "a", px: 12, py: 34 }]);
    expect(RankingService.computeRanks(restored.getRankingMembers()).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("복원본은 원본과 독립이다 — 한쪽 변경이 다른 쪽에 새지 않는다", () => {
    const room = new Room("ABCD", "jungnim", 32);
    room.addMember("a", "가희");
    const restored = Room.restore(room.snapshot(), 32);

    restored.markDied("a", 5);
    expect(room.getRankingMembers()[0]!.alive).toBe(true); // 원본은 그대로
  });

  it("빈 방의 유예 시계도 함께 보존된다", () => {
    const room = new Room("ABCD", "jungnim", 32);
    room.markEmpty(1234);
    expect(Room.restore(room.snapshot(), 32).emptySince).toBe(1234);
  });
});

describe("방 코드 발급", () => {
  it("발급한 코드는 클라 입력 검증을 통과한다", () => {
    // 문자 집합과 검증 정규식이 어긋나면, 서버가 준 코드를 클라가 거부하는
    // 조용한 버그가 된다(I·O는 1·0과 헷갈려 애초에 빠져 있다).
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(parseClientMessage({ type: "join_room", code, nickname: "고수" })).not.toBeNull();
    }
  });
});

describe("프로토콜 런타임 검증", () => {
  it("정상 메시지만 통과시킨다", () => {
    expect(parseClientMessage({ type: "join_room", code: "ABCD", nickname: "고수" }))
      .toEqual({ type: "join_room", code: "ABCD", nickname: "고수" });
    expect(parseClientMessage({ type: "player_state", px: Infinity, py: 1 })).toBeNull();
    expect(parseClientMessage({ type: "player_died", survivalTicks: -1 })).toBeNull();
    expect(parseClientMessage({ type: "join_room", code: "AIO1", nickname: "고수" })).toBeNull();
  });
});
