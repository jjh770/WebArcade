# ============================================================
# 게임 서버(@arcade/server) 컨테이너 — Fly.io 배포용
# ------------------------------------------------------------
# 빌드 컨텍스트는 **저장소 루트**다. npm workspaces라 server 혼자서는
# 빌드되지 않는다 — @arcade/shared를 함께 가져와야 타입이 맞는다.
#
# ⚠️ 방 상태는 서버 메모리에 있다. 인스턴스를 2개 이상 띄우면 같은 방
#    사람들이 서로 다른 머신에 붙어 방이 갈라진다. fly.toml에서 반드시
#    1대만 유지할 것.
# ============================================================

FROM node:22-alpine AS build
WORKDIR /app

# 의존성 레이어를 먼저 굳혀 캐시를 살린다(소스만 바뀌면 npm ci를 건너뛴다).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/games/jungnim/package.json packages/games/jungnim/
COPY packages/server/package.json packages/server/
COPY packages/app/package.json packages/app/
RUN npm ci

COPY . .
# tsc -b가 프로젝트 참조를 따라가 @arcade/shared까지 함께 빌드한다.
RUN npm run build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# workspace 심볼릭 링크(node_modules/@arcade/*)를 살려야 하므로 통째로 복사한다.
COPY --from=build /app ./
EXPOSE 8080
CMD ["node", "packages/server/dist/index.js"]
