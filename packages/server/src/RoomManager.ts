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

  private generateCode(): string {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    return code;
  }
}
