import { describe, expect, it } from "vitest";
import { RankingService } from "../packages/server/src/RankingService";
import { Room } from "../packages/server/src/Room";
import { RoomManager } from "../packages/server/src/RoomManager";
import { parseClientMessage } from "../packages/server/src/validation";

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

  it("유예가 지나면 회수된다 — 죽은 방이 코드를 붙들지 않는다", () => {
    const manager = new RoomManager();
    const room = manager.createRoom("jungnim");
    room.addMember("host", "호스트");
    room.disconnectMember("host", 0);
    room.markEmpty(0);

    expect(manager.reapExpired(GRACE - 1, GRACE)).toEqual([]);
    expect(manager.getRoom(room.code)).toBeDefined();

    expect(manager.reapExpired(GRACE, GRACE)).toEqual([room.code]);
    expect(manager.getRoom(room.code)).toBeUndefined();
  });

  it("사람이 있는 방은 절대 회수하지 않는다", () => {
    const manager = new RoomManager();
    const room = manager.createRoom("jungnim");
    room.addMember("host", "호스트");
    expect(manager.reapExpired(GRACE * 100, GRACE)).toEqual([]);
    expect(manager.getRoom(room.code)).toBeDefined();
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
