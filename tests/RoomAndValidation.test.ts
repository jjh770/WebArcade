import { describe, expect, it } from "vitest";
import { RankingService } from "../packages/server/src/RankingService";
import { Room } from "../packages/server/src/Room";
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

describe("프로토콜 런타임 검증", () => {
  it("정상 메시지만 통과시킨다", () => {
    expect(parseClientMessage({ type: "join_room", code: "ABCD", nickname: "고수" }))
      .toEqual({ type: "join_room", code: "ABCD", nickname: "고수" });
    expect(parseClientMessage({ type: "player_state", px: Infinity, py: 1 })).toBeNull();
    expect(parseClientMessage({ type: "player_died", survivalTicks: -1 })).toBeNull();
    expect(parseClientMessage({ type: "join_room", code: "AIO1", nickname: "고수" })).toBeNull();
  });
});
