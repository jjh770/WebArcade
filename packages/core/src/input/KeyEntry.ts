/* ============================================================
   KeyEntry — 키보드 타자를 게임 슬러그로
   ------------------------------------------------------------
   InputManager·TouchInput과 나란히 서지만 **모양이 다르다.** 저쪽은 InputSource라
   "지금 눌려 있는가"를 물어보면 답하고(폴링), 이쪽은 눌린 순간을 **밀어 넣는다**(푸시).

   왜 나눴는가: 회피 게임의 방향은 상태고 타자는 사건이다. 상태는 60Hz로 뽑아도
   손해가 없지만, 사건을 뽑아 보면 스텝 사이에 눌렸다 떼인 키가 통째로 사라진다.
   숫자 세 개를 빠르게 치는 게임에서 그건 글자가 빠지는 버그다.

   슬러그는 `"0"`~`"9"` · `"back"` · `"enter"` 셋뿐이고, core는 뜻을 모른다 —
   게임이 해석한다(consumeSounds와 같은 결).

   ⚠️ 로컬 입력이라 결정론 대상이 아니다(InputManager 주석 참조).
   ============================================================ */

/** 브라우저 KeyboardEvent.key → 게임에 넘길 슬러그. 우리가 안 쓰는 키는 null.
 *  숫자 키패드도 key는 그냥 "0"~"9", 키패드 엔터도 "Enter"라 따로 볼 게 없다. */
export function keyToSlug(key: string): string | null {
  if (key.length === 1 && key >= "0" && key <= "9") return key;
  if (key === "Backspace") return "back";
  if (key === "Enter") return "enter";
  return null;
}

export class KeyEntry {
  private listening = false;

  constructor(
    /** 슬러그가 하나 나올 때마다 호출. 보통 GameRunner.typeKey를 건다. */
    private readonly onKey: (slug: string) => void,
    /** 리스너 부착 대상. 기본은 window(테스트 시 주입 가능). */
    private readonly target: Window = window,
  ) {}

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.target.addEventListener("keydown", this.onKeyDown);
  }

  stop(): void {
    if (!this.listening) return;
    this.listening = false;
    this.target.removeEventListener("keydown", this.onKeyDown);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    // ⚠️ Ctrl+R·Cmd+숫자 같은 브라우저 단축키는 건드리지 않는다. 이걸 안 거르면
    //    새로고침 하려다 숫자가 들어가고, 단축키는 단축키대로 먹는다.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // 꾹 눌러 생기는 자동 반복은 무시한다 — 지우기가 순식간에 다 지워진다.
    if (event.repeat) return;
    const slug = keyToSlug(event.key);
    if (slug === null) return;
    // Backspace의 뒤로가기, Enter의 "포커스된 버튼 누르기"를 막는다.
    event.preventDefault();
    this.onKey(slug);
  };
}
