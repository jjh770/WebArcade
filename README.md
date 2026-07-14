# Arcade Framework — 웹 멀티 아케이드

같은 시드로 모두가 같은 세계를 각자 화면에서 겪고, 판정 결과는 생존/사망으로 동기화하는
**결정론적 동기화 기반 웹 멀티 아케이드 프레임워크**. 관전을 위해 위치는 10Hz 방 단위 스냅샷으로 중계한다.

첫 게임은 **죽림고수**(사방에서 날아오는 화살 피하기). 최대한 많은 인원이 같은 화살 패턴을 각자
화면에서 겪으며 누가 더 오래 버티는지 겨룬다.

> 설계 철학: **설계 판단은 사람이, 반복 검증은 AI가.**
> 상세 설계는 [`DESIGN.md`](./DESIGN.md), AI 협업 규칙은 [`AGENTS.md`](./AGENTS.md) 참조.

## 스택

- TypeScript(strict) 모노레포 (npm workspaces)
- 클라이언트: Canvas 2D + Vite (`IRenderer` 추상 → 필요 시 PixiJS 교체)
- 서버: Node.js + `ws` WebSocket (방·시드·순위만 관리. 게임 내용을 모름)
- 게임 루프: 고정 타임스텝 누산기 (결정론 보장)

## 구조

```
packages/
├─ shared/        # 계약: IGame · IRenderer · 프로토콜 · 타입 (모두가 의존)
├─ core/          # 엔진: GameLoop · SeededRNG · 렌더러 (게임을 모름)
├─ games/
│  └─ jungnim/    # 죽림고수 (IGame 구현)
├─ server/        # WebSocket 서버 (방·시드·순위)
└─ app/           # 진입점 + GameRegistry (게임 등록)
```

**의존성 규칙**: 모든 의존성은 위로만 향한다. `core`는 `games`를 import하지 않는다.
새 게임을 추가해도 `core`는 한 줄도 바뀌지 않아야 한다.

## 실행

```bash
npm install
npm run typecheck      # 전체 타입 검사 (tsc -b)
npm test               # 결정론·FSM·방 흐름 회귀 테스트 (Vitest)
npm run dev            # 클라이언트 개발 서버
npm run dev:server     # WebSocket 서버 (별도 터미널)
npm run build          # 클라이언트 정적 빌드
npm run build:server   # 서버 빌드 (dist/index.js)
```

## 배포

프론트(정적 파일)와 게임 서버(상시 WebSocket)는 성격이 달라 **따로 올린다**.

### 1. 게임 서버 → Fly.io

```bash
fly launch --no-deploy   # 최초 1회. app 이름이 겹치면 fly.toml의 app 값을 바꾼다
fly deploy
curl https://<app>.fly.dev/health   # {"ok":true} 나오면 성공
```

⚠️ **머신은 1대만 유지해야 한다.** 방 상태가 서버 메모리에 있어서, 2대 이상이면 같은 방
사람들이 서로 다른 머신에 붙어 방이 갈라지고, 머신이 잠들면 진행 중인 방이 사라진다.
`fly.toml`이 이미 `auto_stop_machines = false` / `min_machines_running = 1`로 잡아 뒀다.

### 2. 프론트 → Vercel / Cloudflare Pages

저장소를 연결하고 환경변수 **`VITE_WS_URL = wss://<app>.fly.dev`** 를 넣는다.
(Vercel은 `vercel.json`이 빌드 설정을 이미 갖고 있다. Cloudflare Pages는 빌드 명령
`npm run build`, 출력 디렉터리 `packages/app/dist`로 직접 설정한다.)

⚠️ 페이지가 https면 `ws://`는 브라우저가 **mixed content로 차단**한다 — 반드시 `wss://`.
`VITE_WS_URL`을 안 넣으면 로컬 개발 기본값(`ws://<호스트>:8080`)으로 붙으려다 실패한다.

## 새 게임 추가법

이 프레임워크의 핵심: 새 게임은 **인터페이스 하나 구현 + 레지스트리 등록**이면 된다.

1. `packages/games/<name>/` 생성, `IGame`을 구현하는 클래스 작성
   (`init`/`update`/`render`/`renderSpectator`/`isPlayerDead`/`getPosition`/`syncPeers`/`getScore`).
2. 게임 튜닝값은 `config.ts`에 데이터로 분리 (`scoreDirection` 포함).
3. `packages/app/src/GameRegistry.ts`의 `GAME_REGISTRY`에 항목 추가 (factory 함수 포함).

→ 게임 선택 화면 목록에 자동으로 나타난다. `core`·서버는 수정하지 않는다.

⚠️ **개발 순서 게이트** (DESIGN.md 7절): 죽림고수를 멀티까지 완성해 전체 플로우를 검증한 **뒤에**
두 번째 게임을 추가한다. 그 시점에 `IGame` 인터페이스가 안 맞는 부분을 넓혀 추상화를 확정한다.
검증 전 조기 추상화 금지.

## 결정론 불변식 (절대 규칙)

> 게임 결과에 영향을 주는 모든 것은 시드와 tick에서만 파생된다.
> 시스템 시계·전역 상태·실측 delta는 결과 계산에 끼어들지 않는다.

- 게임 로직에 `Math.random()` 금지 → `SeededRNG`만
- `update()`는 고정 스텝만 (실측 deltaTime 안 받음)
- 난이도·스폰은 `tick`의 함수 (`Date.now()` 금지)
- 피격 판정은 로컬, 네트워크로는 생존/사망 결과만

## 멀티·관전 기준

- 방 상태는 범용 FSM으로 `Ready → Countdown → Playing → Dead/Watching → Result` 전이
- 서버 시각을 5회 측정해 예약된 `startTime`부터 동일한 tick 진행
- v1 방 최대 32명
- 플레이어 위치는 10Hz로 보내고 서버가 `peer_snapshot`으로 일괄 중계
- 공통 화살은 정확히 결정론 재현, 원격 이동·개인 화살은 관전용 시각적 근사
- 게임은 전원 사망 시 종료, 호스트가 전원을 대기실로 돌린 뒤 새 시드로 재시작
