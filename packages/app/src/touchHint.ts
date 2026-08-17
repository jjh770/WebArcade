/* ============================================================
   touchHint — "화면 어디를 눌러야 하는가"를 잠깐 보여준다
   ------------------------------------------------------------
   터치 조작에는 키보드에 없는 문제가 있다. 방향키는 키캡에 화살표가 새겨져
   있지만 화면에는 아무 표시가 없어서, 알려주지 않으면 아무도 모른다.

   뜨는 구간은 **카운트다운 3초**다. 판이 내려오는 동안 뒤에 깔렸다가 게임이
   시작되면 걷힌다 — 플레이가 시작된 뒤에는 화면을 조금도 가리지 않는다.

   순수 장식이 아니라 안내다. 그래서 reduced-motion에서도 없애지 않고
   페이드만 뺀다(UI_MOTION.md "끄되 정보는 남긴다").

   ⚠️ 캔버스 위에 떠 있지만 pointer-events: none이라 터치를 가로채지 않는다.
      가로채면 조작 자체가 막힌다.
   ============================================================ */

import { type TouchScheme } from "./touchSchemes";

/** 조작 방식별 한 줄 안내. **여기 항목이 있다 = 판을 덮는 안내가 있다**이고, 그게 곧
 *  카운트다운이 자기 막을 걷어도 되는 조건이다(아래 show 참조). 조이스틱·버튼은
 *  조작 요소 자체가 화면에 보이므로 오버레이를 쓰지 않는다. */
const CAPTIONS: Partial<Record<TouchScheme, string>> = {
  halves: "누르고 있는 동안 꺾입니다",
  // 조준도 판이 곧 조작면이라 눈에 보이는 표시가 없다 — 알려주지 않으면 아무도 모른다.
  aim: "판을 짚은 자리를 겨눕니다",
};

/** 터치 조작이 있는 게임인가 + 손가락으로 누를 수 있는 기기인가.
 *  둘 다여야 띄운다 — 데스크톱에서 뜨면 방향키를 쓰는 사람에게 방해만 된다. */
export function shouldShowHint(hasTouchMapping: boolean, coarsePointer: boolean): boolean {
  return hasTouchMapping && coarsePointer;
}

/** 이 기기를 손가락으로 누르는가. 마우스만 있으면 false. */
export function hasCoarsePointer(): boolean {
  return matchMedia("(pointer: coarse)").matches;
}

export class TouchHint {
  private scheme: TouchScheme | null = null;

  /** @param element 안내 오버레이 @param surface 터치를 받는 면(캔버스) */
  constructor(
    private readonly element: HTMLElement,
    private readonly surface: HTMLElement,
  ) {}

  /** 오버레이를 터치 면과 같은 자리·크기로 맞춘다.
   *  캔버스 크기는 창 크기·관전창 유무에 따라 변하므로 그때마다 다시 부른다.
   *  (매 프레임이 아니라 레이아웃이 바뀔 때만 — UI_MOTION.md 성능)
   *
   *  ⚠️ getBoundingClientRect가 아니라 offset*을 쓴다. 카운트다운 동안 캔버스는
   *     위에서 내려오는 중(transform)이라 rect가 "지금 보이는 자리"를 준다 —
   *     그걸 따라가면 안내가 화면 밖에서 같이 내려온다. offset*은 변형을 무시한다. */
  syncBox(): void {
    const style = this.element.style;
    // 둘 다 #play의 패딩 박스를 기준으로 하는 좌표라 그대로 옮겨 쓸 수 있다.
    style.left = `${this.surface.offsetLeft}px`;
    style.top = `${this.surface.offsetTop}px`;
    style.width = `${this.surface.offsetWidth}px`;
    style.height = `${this.surface.offsetHeight}px`;
  }

  /** 이 게임의 조작 방식. 매핑을 갈아 끼울 때 반드시 같이 부른다 —
   *  좌우로 조작하는데 끌라고 안내하면 안 된다. */
  setScheme(scheme: TouchScheme | null): void {
    this.scheme = scheme;
    this.element.classList.toggle("mode-halves", scheme === "halves");
    const caption = this.element.querySelector(".tz-caption");
    if (caption) caption.textContent = (scheme && CAPTIONS[scheme]) ?? "";
  }

  /** 오버레이를 쓰는 방식일 때만 뜬다. 조이스틱은 위젯이 이미 화면에 보이므로
   *  판을 덮을 이유가 없다. */
  show(): void {
    if (!this.scheme || !CAPTIONS[this.scheme]) return;
    this.syncBox();
    this.element.classList.add("on");
    // 여기까지 왔다는 건 판을 덮는 안내가 깔렸다는 뜻이다. 그러니 카운트다운은 막을
    // 걷는다 — 두 겹이면 안내가 묻힌다. 숫자 대비는 이 막이 대신 책임진다.
    document.body.classList.add("hint-dims");
  }

  hide(): void {
    this.element.classList.remove("on");
    document.body.classList.remove("hint-dims");
  }
}
