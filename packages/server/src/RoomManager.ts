/* ============================================================
   RoomManager — 방 생성·조회·삭제
   ------------------------------------------------------------
   코드 문자셋에서 I, O를 제외한다(1·0과 혼동 방지 — TETR.IO 방식).
   ============================================================ */

import { Room } from "./Room";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // I, O 제외
const CODE_LENGTH = 4;

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(gameId: string): Room {
    let code: string;
    do {
      code = this.generateCode();
    } while (this.rooms.has(code));

    const room = new Room(code, gameId);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  deleteRoom(code: string): void {
    this.rooms.delete(code);
  }

  private generateCode(): string {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }
}
