/* ============================================================
   dom — 요소를 집는 유일한 통로
   ------------------------------------------------------------
   화면을 다루는 파일이 여럿이라(AppView·playLayout·screenFx·touchControls)
   저마다 getElementById를 부르면 "없는 id를 조용히 무시하는" 코드가 흩어진다.
   여기 하나만 두고 **없으면 즉시 던진다** — 마크업과 코드가 어긋나면 첫 실행에서
   드러나야지, 나중에 아무 반응이 없는 버튼으로 나타나면 안 된다.
   ============================================================ */

export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} 요소를 찾을 수 없습니다.`);
  return element as T;
};
