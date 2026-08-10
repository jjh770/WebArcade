/* 방 상태·검증 순수 로직 테스트 — 평범한 Node에서 돈다.
   전송 계층(Durable Object·WebSocket·알람)은 workerd가 필요해서
   `packages/edge/test/`에서 따로 돈다. (`npm test`가 둘 다 실행한다) */
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

  /* 끊긴 사람의 최종 기록.
     예전에는 서버가 흐른 시간(tick)을 지어내 채웠다. 앞의 세 게임은 생존 tick이 곧
     기록이라 맞았지만, 숫자 야구는 같은 칸에 **점수**가 온다 — 실제로 80초짜리 판이
     결과표에 "4826점"으로 찍혔다. 서버는 그 숫자가 무엇인지 모르므로 지어내면 안 된다. */
  describe("끊긴 사람의 기록", () => {
    /** 라운드 진행 중인 방 하나. */
    const playing = (): Room => {
      const room = new Room("ABCD", "baseball", 4);
      room.addMember("a", "A");
      room.addMember("b", "B");
      room.startCountdown(1, 0);
      room.ensurePlaying(1);
      return room;
    };

    it("서버가 지어내지 않는다 — 마지막으로 알려온 기록을 그대로 쓴다", () => {
      const room = playing();
      room.updatePosition("a", 0, 0, undefined, 220);
      // 80초가 흐른 뒤 끊긴다. 예전이라면 4800(=80초×60)이 들어갔다.
      room.disconnectMember("a", 80_000);
      const [entry] = RankingService.computeRanks(room.getRankingMembers()).filter((r) => r.id === "a");
      expect(entry!.score).toBe(220);
    });

    it("한 번도 안 알려왔으면 0이다 — 모르는 값을 추측하지 않는다", () => {
      const room = playing();
      room.disconnectMember("a", 80_000);
      expect(room.getRankingMembers().find((m) => m.id === "a")!.finalScore).toBe(0);
    });

    it("계속 알려오면 마지막 값이 남는다", () => {
      const room = playing();
      for (const score of [50, 120, 300]) room.updatePosition("a", 0, 0, undefined, score);
      room.disconnectMember("a", 80_000);
      expect(room.getRankingMembers().find((m) => m.id === "a")!.finalScore).toBe(300);
    });

    it("이미 죽은 사람의 기록은 끊겨도 안 바뀐다 — 본인이 낸 최종값이 우선이다", () => {
      const room = playing();
      room.updatePosition("a", 0, 0, undefined, 300);
      room.markDied("a", 450); // 마지막 문제를 풀고 죽었다 → 300이 아니라 450
      room.disconnectMember("a", 80_000);
      expect(room.getRankingMembers().find((m) => m.id === "a")!.finalScore).toBe(450);
    });

    it("새 라운드는 지난 판의 기록을 물려받지 않는다", () => {
      const room = playing();
      room.updatePosition("a", 0, 0, undefined, 300);
      room.startCountdown(2, 0);
      room.ensurePlaying(1);
      room.disconnectMember("a", 80_000);
      expect(room.getRankingMembers().find((m) => m.id === "a")!.finalScore).toBe(0);
    });
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
    room.addMember("a", "고수");
    room.addMember("b", "초심자");
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
    room.addMember("a", "고수");
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
    // ev는 선택 — 없으면 그대로 통과하고, 있으면 짧은 슬러그 형식만 본다(의미는 서버 밖).
    expect(parseClientMessage({ type: "player_state", px: 1, py: 2 })).toEqual({ type: "player_state", px: 1, py: 2 });
    expect(parseClientMessage({ type: "player_state", px: 1, py: 2, ev: "purge" }))
      .toEqual({ type: "player_state", px: 1, py: 2, ev: "purge" });
    expect(parseClientMessage({ type: "player_state", px: 1, py: 2, ev: "PURGE!" })).toBeNull();
    expect(parseClientMessage({ type: "player_state", px: 1, py: 2, ev: "x".repeat(33) })).toBeNull();
    // sc(지금까지의 기록)는 0 이상 정수만. 형식이 틀리면 **sc만 빠지고 메시지는 산다** —
    // 10Hz로 오는 관전 정보라 한 필드 때문에 버리면 남의 화면에서 그 사람이 얼어붙는다.
    expect(parseClientMessage({ type: "player_state", px: 1, py: 2, sc: 220 }))
      .toEqual({ type: "player_state", px: 1, py: 2, sc: 220 });
    for (const bad of [-1, 1.5, Number.NaN, Infinity, "220", null]) {
      expect(parseClientMessage({ type: "player_state", px: 1, py: 2, sc: bad }))
        .toEqual({ type: "player_state", px: 1, py: 2 });
    }
    expect(parseClientMessage({ type: "player_died", score: -1 })).toBeNull();
    expect(parseClientMessage({ type: "join_room", code: "AIO1", nickname: "고수" })).toBeNull();
  });

  it("fire_effect은 kind 슬러그·durationMs 범위·targetId 형식을 검사한다", () => {
    const ok = { type: "fire_effect", kind: "invert", durationMs: 2500, targetId: "player-1" };
    // 정상: 짧은 슬러그 + 유한한 지속시간 + 타깃 id
    expect(parseClientMessage(ok)).toEqual(ok);
    // kind 형식 위반(대문자/공백/과길이)·durationMs 상한/0·비유한은 거부
    expect(parseClientMessage({ ...ok, kind: "INVERT" })).toBeNull();
    expect(parseClientMessage({ ...ok, kind: "a".repeat(33) })).toBeNull();
    expect(parseClientMessage({ ...ok, durationMs: 0 })).toBeNull();
    expect(parseClientMessage({ ...ok, durationMs: 999999 })).toBeNull();
    expect(parseClientMessage({ ...ok, durationMs: Infinity })).toBeNull();
    // targetId 누락·빈 문자열·과길이는 거부(조준 대상이 반드시 있어야 한다)
    expect(parseClientMessage({ type: "fire_effect", kind: "invert", durationMs: 2500 })).toBeNull();
    expect(parseClientMessage({ ...ok, targetId: "" })).toBeNull();
    expect(parseClientMessage({ ...ok, targetId: "a".repeat(65) })).toBeNull();
  });
});
