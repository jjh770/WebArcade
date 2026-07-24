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
- 서버: Cloudflare Workers + Durable Objects (**방 하나 = 오브젝트 하나**. 방·시드·순위만 관리하고 게임 내용을 모름)
- 게임 루프: 고정 타임스텝 누산기 (결정론 보장)

## 구조

```
packages/
├─ shared/        # 계약: IGame · IRenderer · 프로토콜 · 타입 (모두가 의존)
├─ core/          # 엔진: GameLoop · SeededRNG · StateMachine · ClockSync · 렌더러 (게임을 모름)
├─ games/
│  └─ jungnim/    # 죽림고수 (IGame 구현)
├─ edge/          # 게임 서버 (Workers + DO). 방·시드·순위. 게임 내용을 모름
└─ app/           # 진입점 + GameRegistry (게임 등록)
tests/            # Vitest(Node) — 결정론·클럭·FSM·방 로직 회귀
packages/edge/test/  # Vitest(workerd) — DO·WebSocket·알람 통합
```

**의존성 규칙**: 모든 의존성은 위로만 향한다. `core`는 `games`를 import하지 않는다.
새 게임을 추가해도 `core`는 한 줄도 바뀌지 않아야 한다.

## 빠른 시작

세 가지 시나리오로 정리한다. 대부분은 **1번(로컬)** 이면 충분하다.

### 1. 로컬에서 켜기 (개발용, 배포 불필요)

내 컴퓨터에서 지금 코드를 그대로 실행한다. 터미널 **두 개**가 필요하다.

```bash
npm install            # 최초 1회 (또는 의존성 바뀐 뒤)

# 터미널 A — 클라이언트
npm run dev            # localhost 주소가 출력된다. 이 주소로 접속.

# 터미널 B — 게임 서버 (멀티까지 볼 때만 필요)
npm run dev:server     # localhost:8787 — Cloudflare 계정 없이 로컬에서 돈다
```

- **혼자 연습하기**는 서버 없이 터미널 A만으로 된다.
- **방 만들기 / 멀티**는 터미널 B(서버)도 켜야 한다.
- 코드를 저장하면 새로고침 없이 바로 반영된다(HMR).

멀티를 한 컴퓨터에서 테스트하려면 브라우저 탭을 여러 개 열고 한 탭에서 방을 만들어 코드를 공유하면 된다.

### 2. 최신 버전을 라이브로 올리기

바꾼 코드를 실제 배포 주소(https://web-arcade-sigma.vercel.app)에 반영한다.

```bash
# (1) 커밋 — 배포는 커밋된 상태 기준이 깔끔하다
git add -A && git commit -m "..."

# (2) 검증 — 깨진 채로 올리지 않는다
npm run typecheck && npm test

# (3) 프론트 배포 (app·core·games·shared를 고쳤을 때)
vercel --prod

# (4) 서버 배포 (edge·shared를 고쳤을 때만)
npm run deploy:server
```

- 대부분의 변경(게임·연출·UI)은 **프론트만**이라 (3)만 하면 된다.
- ⚠️ `edge`나 `shared`(프로토콜)를 고쳤으면 (4)도 필수. 아래 [배포](#배포) 표 참조.
- 서버는 쓰지 않을 때 잠들고 요청이 오면 깨어난다 — 따로 켜고 끌 일이 없다.

### 3. 처음부터 세팅 (빈 컴퓨터 → 배포까지)

```bash
# 사전: Node 20+ 설치 (node -v 로 확인)

# 저장소 준비
git clone <저장소 주소> && cd WebArcade
npm install
npm run dev            # 로컬이 뜨는지 먼저 확인

# 배포 도구 (wrangler는 이미 devDependency라 전역 설치가 필요 없다)
npm i -g vercel        # 프론트

# 로그인 (둘 다 브라우저가 열린다)
vercel login
npx wrangler login

# 게임 서버 배포 (wrangler.toml의 설정을 그대로 쓴다)
npm run deploy:server
curl https://webarcade.<서브도메인>.workers.dev/health   # {"ok":true} 확인

# 프론트: Vercel에 서버 주소를 환경변수로 넣고 배포
vercel                                     # 최초 연결(프로젝트 생성)
vercel env add VITE_WS_URL production      # 값: wss://webarcade.<서브도메인>.workers.dev
vercel --prod                              # 이 값이 번들에 박힌다
```

> 첫 배포 때 workers.dev 서브도메인 등록을 묻는다. **계정 전체에 하나**뿐이라
> 프로젝트명이 아니라 본인 식별자로 정하는 편이 낫다. Cloudflare 계정의
> **이메일 인증**을 마치지 않으면 배포가 거부된다.

⚠️ `VITE_WS_URL`은 **빌드 타임에 번들에 박힌다.** 서버 주소를 바꾸면 환경변수만 고쳐선 안 되고
`vercel --prod`로 다시 빌드해야 한다. https 페이지이므로 반드시 `wss://`(ws는 브라우저가 차단).

### 참고: 개별 명령

```bash
npm run typecheck      # 전체 타입 검사 (tsc -b)
npm test               # 전체 테스트 (Node 단위 + workerd 통합)
npx vitest run --project unit   # 순수 로직만 (빠름)
npx vitest run --project edge   # 서버 전송 계층만 (workerd 안에서 실행)
npm run build          # 클라이언트 정적 빌드
```

## 배포

**라이브**: https://web-arcade-sigma.vercel.app (서버: `wss://webarcade.leon770.workers.dev`)

프론트(정적 파일)와 게임 서버(WebSocket)는 성격이 달라 **따로 올린다**.
자세한 근거와 제약은 [`DESIGN.md` 9절](./DESIGN.md) 참조.

**바꾼 패키지에 따라 재배포 대상이 다르다. `shared`(프로토콜)를 고치면 반드시 둘 다** —
한쪽만 올리면 서버와 클라가 서로 다른 메시지 형식을 쓰게 되어 조용히 깨진다.

| 고친 곳 | 재배포 |
|---|---|
| `app` · `core` · `games` | `vercel --prod` |
| `edge` | `npm run deploy:server` |
| `shared` | **둘 다** |

### 게임 서버 → Cloudflare Workers

```bash
npm run deploy:server
curl https://webarcade.<서브도메인>.workers.dev/health   # {"ok":true} 나오면 성공
```

**방 하나 = Durable Object 하나**라 인스턴스 수를 신경 쓸 필요가 없다. 방 코드로 라우팅되므로
어느 지역에서 접속하든 같은 방으로 모인다. 쓰지 않을 때는 잠들어 비용이 들지 않는다.

⚠️ **배포하면 진행 중인 방의 오브젝트가 새 코드로 갈아탄다 = 접속자가 튕긴다.**
사람들이 플레이 중일 때 배포하지 않는다.

⚠️ 무료 플랜은 **SQLite 백엔드 Durable Object만** 쓸 수 있다. `wrangler.toml`의 마이그레이션이
`new_sqlite_classes`인 이유이고, 바꾸면 배포가 거부된다.

### 프론트 → Vercel

```bash
vercel --prod
```

환경변수 **`VITE_WS_URL = wss://webarcade.<서브도메인>.workers.dev`** 가 Production에 등록돼
있어야 한다 (`vercel env add VITE_WS_URL production`). 빌드 설정은 `vercel.json`에 있다.
방 만들기용 HTTP 주소는 클라가 `ws→http`로 유도하므로 따로 설정하지 않는다.

⚠️ 이 값은 **빌드 타임에 번들에 박힌다.** 서버 주소를 바꾸면 환경변수만 고쳐선 소용없고
`vercel --prod`로 다시 빌드해야 반영된다. 페이지가 https이므로 반드시 `wss://` —
`ws://`는 브라우저가 mixed content로 차단한다.

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
