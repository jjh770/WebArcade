import { defineConfig } from "vite";

// 친구(gahee)는 React 플러그인을 썼지만, 이 프로젝트의 게임 화면은
// Canvas 중심이라 React가 필수는 아니다. 메뉴/로비/순위표 UI에 React가
// 필요해지면 그때 @vitejs/plugin-react를 추가한다.
export default defineConfig({
  build: {
    minify: "esbuild",
  },
});
