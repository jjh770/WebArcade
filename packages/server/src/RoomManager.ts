import { randomInt } from "node:crypto";
import { Room } from "./Room.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 4;
export const ROOM_CAPACITY = 32;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  createRoom(gameId: string): Room {
    let code: string;
    do code = this.generateCode(); while (this.rooms.has(code));
    const room = new Room(code, gameId, ROOM_CAPACITY);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  getRooms(): readonly Room[] {
    return [...this.rooms.values()];
  }

  deleteRoom(code: string): void {
    this.rooms.delete(code);
  }

  /** 유예가 끝난 빈 방을 회수한다. 주기적으로 호출. 회수된 코드를 돌려준다.
   *  (유예 동안은 방이 남아 있어, 새로고침·네트워크 끊김으로 나갔던 사람이 같은 코드로 복귀할 수 있다.) */
  reapExpired(now: number, graceMs: number): string[] {
    const reaped: string[] = [];
    for (const room of this.rooms.values()) {
      if (!room.isExpired(now, graceMs)) continue;
      this.rooms.delete(room.code);
      reaped.push(room.code);
    }
    return reaped;
  }

  private generateCode(): string {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    return code;
  }
}
