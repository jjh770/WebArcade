# Arcade Framework — 웹 멀티 아케이드

같은 시드로 모두가 같은 세계를 각자 화면에서 겪고, 판정 결과는 생존/사망으로 동기화하는
**결정론적 동기화 기반 웹 멀티 아케이드 프레임워크**. 관전을 위해 위치는 10Hz 방 단위 스냅샷으로 중계한다.

첫 게임은 **죽림고수**(사방에서 날아오는 화살 피하기). 최대한 많은 인원이 같은 화살 패턴을 각자
화면에서 겪으며 누가 더 오래 버티는지 겨룬다. 두 번째 게임 **커브 피버**(좌우로 꺾어 선을 그리고
꼬리·벽에 부딪히면 죽음)가 멀티·관전까지 완주하며 프레임워크가 다른 장르도 담는다는 걸 검증했다
(`core`는 한 줄도 안 바뀌었고, `IGame`은 선택 메서드 5개만 넓혔다).

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
│  ├─ jungnim/    # 죽림고수 — 화살 피하기 (IGame 구현)
│  └─ curve/      # 커브 피버 — 선 긋기 (IGame 구현)
├─ edge/          # 게임 서버 (Workers + DO). 방·시드·순위. 게임 내용을 모름
└─ app/           # 진입점 + GameRegistry (게임 등록)
   ├─ UI_DESIGN.md   # 사이트 UI의 색·타이포·컴포넌트 (UI 작업 때만)
   └─ UI_MOTION.md   # 화면 전환·연출 (모션을 고칠 때만)
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

## 순위표 관리

전역 순위표(혼자 플레이 기록)에서 줄을 지우는 도구다. 관리자 화면은 없다 —
운영자가 한 명이고, 그 한 명은 이 저장소가 있는 컴퓨터 앞에 있다.

```bash
npm run board -- ls curve              # 순위표 보기 (열쇠 불필요)
npm run board -- rm curve 닉네임        # 지우기 (되돌릴 수 없음)
npm run board -- rm all 닉네임          # 세 게임에서 한꺼번에
npm run board -- mv curve 옛이름 새이름  # 이름만 바꾸기 (기록·등수 유지)
```

**욕설 닉네임에는 `rm`보다 `mv`를 먼저 쓴다.** 기록을 세운 것 자체는 잘못이 아닐 수 있고,
지우면 순위표에 구멍이 생기지만 이름만 바꾸면 등수가 남는다. 무엇보다 **되돌릴 수 있다** —
`rm`으로 지운 줄은 어디에도 남지 않아 복구할 방법이 없다.

게임id는 `jungnim`(죽림고수) · `curve`(커브 피버) · `floor`(무너지는 바닥) · `baseball`(숫자 야구)다.
게임을 추가하면 `rm all`이 훑을 목록(`scripts/board.mjs`의 `GAMES`)에도 넣어야 한다 —
서버에는 "게임 목록"을 묻는 경로가 없다(서버는 gameId를 문자열로만 다룬다).

처음 한 번만 열쇠를 심는다. **ASCII로 짓는다** — 헤더는 Latin-1만 담을 수 있어
한글 열쇠는 서버에 닿지도 못한다.

```bash
npx wrangler secret put ADMIN_KEY --cwd packages/edge
```

지울 때마다 열쇠를 묻는 게 번거로우면 저장소 루트에 `.admin-key` 파일로 넣어 둔다
(`.gitignore`에 있다). 환경변수 `ADMIN_KEY`가 있으면 그쪽이 먼저다.

⚠️ **서버에 `ADMIN_KEY`가 없으면 삭제 경로가 통째로 404가 된다.** 열쇠가 틀렸을 때도
404다 — 열쇠 없는 사람에게 "여기 뭔가 있다"를 알려주지 않으려는 것이라, 스크립트가
404를 받으면 대개 주소가 아니라 열쇠 문제다.

로컬 서버(`npm run dev:server`)로 시험하려면 운영 열쇠 대신 `packages/edge/.dev.vars`에
`ADMIN_KEY=...`를 넣고 `ARCADE_SERVER=http://localhost:8787`로 스크립트를 돌린다.

## 새 게임 추가법

이 프레임워크의 핵심: 새 게임은 **인터페이스 하나 구현 + 레지스트리 등록**이면 된다.

1. `packages/games/<name>/` 생성, `IGame`을 구현하는 클래스 작성
   (`init`/`update`/`render`/`renderSpectator`/`isPlayerDead`/`getPosition`/`syncPeers`/`getScore`).
2. 게임 튜닝값은 `config.ts`에 데이터로 분리 (`scoreDirection`·`scoreUnit` 포함).
   `scoreUnit`은 `getScore()`가 **무엇을** 돌려주는지다 — `"ticks"`면 화면에 `5.1s`,
   `"points"`면 `240점`으로 찍힌다. 게이지가 있으면 `gaugeLabel`·`gaugeAlarm`도 함께 둔다.
3. `packages/app/src/GameRegistry.ts`의 `GAME_REGISTRY`에 항목 추가 (factory 함수 포함).
4. 순위표를 쓰면 `scripts/board.mjs`의 `GAMES`에도 id를 넣는다(`rm all`이 훑을 목록).

**선택 메서드** — 구현하면 그 기능이 켜지고, 안 하면 없는 게임이 된다:
`getGauge()`(HUD 게이지 줄) · `typeKey(slug)`(숫자·글자 입력) · `consumePendingFire()`(방해 발사) ·
`applyEffect(kind, ms)`(피격) · `consumeSounds()`(소리) ·
`consumePeerEvent()`/`applyPeerEvent(id, kind)`(남의 화면에도 보여야 할 연출).
게임마다 서로 다른 부분집합을 쓴다 — 커브 피버는 게이지·발사·피격, 죽림고수는 연출 둘,
숫자 야구는 게이지와 `typeKey`(아래 참조).

→ 게임 선택 화면 목록에 자동으로 나타난다. `core`·서버는 수정하지 않는다.

⚠️ **개발 순서 게이트** (DESIGN.md 7절): 죽림고수를 멀티까지 완성해 전체 플로우를 검증한 **뒤에**
두 번째 게임을 추가한다. 그 시점에 `IGame` 인터페이스가 안 맞는 부분을 넓혀 추상화를 확정한다.
검증 전 조기 추상화 금지. → 현재 두 번째 게임 **커브 피버**가 이 검증을 진행 중이다(입력은
좌/우만 써서 `InputState`를 안 넓혀도 됐고, 관전 계약은 커브 멀티 단계에서 확정될 예정).

**터치 입력도 계약을 안 넓혔다.** `InputState`가 이미 4방향 불리언이라 손가락에서 왔는지
방향키에서 왔는지 게임은 모른다. 키보드 옆에 소스를 하나 더 두고 OR로 합칠 뿐이라
`IGame`도 각 게임도 한 줄 안 바뀌었다. 화면 어디를 누르면 어느 방향인가는 게임마다 다르므로
`core`가 아니라 앱이 정한다(`packages/app/src/touchSchemes.ts`) — 커브 피버는 판 좌/우 절반,
죽림고수는 판 밖의 조이스틱 위젯(손가락이 화살을 가리면 안 되므로), 무너지는 바닥은 방향키
버튼 넷(격자는 한 번에 한 칸이라 미는 위젯이 맞지 않는다).

**넷째 게임(숫자 야구)에서 처음으로 입력 계약이 넓어졌다.** 이 게임은 방향이 아니라 **숫자를
친다.** `InputState`에 숫자를 더하지 않은 이유는 자리 부족이 아니라 종류가 다르기 때문이다 —
저건 「누르고 있다」의 스냅샷이고 타자는 「누른 순간」의 연속이라, 60Hz로 뽑아 보면 스텝 사이에
눌렸다 떼인 키가 사라진다. 그래서 폴링(`InputSource`)이 아니라 **푸시** 통로를 따로 열었다:
`IGame.typeKey?(slug)` + `core`의 `KeyEntry`(keydown → `"0"`~`"9"`·`"back"`·`"enter"`).
숫자를 안 받는 게임에서는 아예 켜지지 않아 Enter·Backspace의 기본 동작을 삼키지 않는다.

그래서 터치 조작 방식이 넷이 됐다 — 네 번째 `keypad`(화면 숫자판)만 **방향을 만들지 않는다.**
앞의 셋은 `InputState`를 내놓고 러너가 매 스텝 물어 가지만(폴링), 숫자판은 눌린 순간 슬러그를
밀어 넣는다(푸시). 같은 파일에 사는 이유는 하나뿐이다 — 조작면이라 **화면 자리를 똑같이 다툰다.**

숫자판은 세로에서 5열×3줄(넓고 낮게), 가로에서 3열×4줄(좁고 높게)로 흐른다. 귀한 축이 반대라서다
— 세로에서는 세로가, 가로에서는 가로가 모자란다.

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

## 게임 밖에서 오는 변수 — 두 갈래

두 게임이 같은 문제("잘 피한 사람에게 보상")를 서로 다르게 푼다. 공통 규칙은 하나 —
**공통 월드(시드에서 나오는 화살·장애물)는 아무도 건드리지 않는다.**

### 커브 피버 — 스릴 게이지 (남을 방해한다)

벽·꼬리·장애물을 스칠수록 게이지가 차고, 꽉 차면 **지금 내 우측 관전창에 떠 있는 상대 1명**에게
방해 디버프를 쏜다. 탄환이 그 관전창까지 날아가 명중하는 연출이 붙는다.
`invert`(좌/우 반전)·`sluggish`(회전 ×0.4)는 게임이 자기 입력 사본에 걸고,
`blur`·`shake`·`cloud`는 앱이 victim 화면에 DOM/CSS로 걸어 게임과 무관하다.

> **왜 결정론이 안 깨지나**: 효과는 맞은 사람의 *입력·시야*만 바꾼다. 공통 월드는 전혀 안
> 건드리므로 클라 간 월드가 어긋나지 않는다 — 락스텝 입력 동기가 필요 없다.
> 대상·디버프를 고르는 난수는 **앱 레이어**에만 있고 게임 `update()`에는 여전히 난수가 없다.
> 서버는 `kind` 문자열을 형식만 검증해 중계하므로 **디버프를 늘려도 서버 재배포가 필요 없다.**

### 죽림고수 — 아이템 (나를 강화한다)

20~28초에 한 번 경기장 어딘가에 아이템이 뜬다(10초 뒤 소멸). **뜨는 시각·자리·종류는 시드와
tick에서만 나와** 모두가 같은 것을 보지만, **줍는 판정은 로컬**이라 남이 가져가도 내 것은 남는다.

| 종류 | 확률 | 효과 |
|---|---|---|
| 질주 | 40% | 5초간 이동 속도 ×1.6 |
| 쉴드 | 25% | 맞아도 3번까지 버틴다(막은 화살은 부서진다) |
| 조준 정지 | 20% | 6초간 나를 노리는 **개인 화살** 스폰이 멈춘다 |
| 정화 | 15% | 반경 280px 안의 화살이 사라진다 |

앞의 셋은 내 판정·입력만 바꿔 관전 화면과 어긋날 여지가 없다. **정화만 예외** — 로컬에서 공통
화살을 지우므로 나를 관전 중인 사람 화면엔 그 화살이 남는다. 그래서 정화를 쓸 때만 `"purge"`
슬러그를 위치 스냅샷에 얹어 보내고, 받은 쪽은 그 사람의 관전창에서 **파동 링 안쪽 화살을 안
그린다**(지우지 않는다 — 지우면 그 사람 자신의 피격 판정까지 바뀐다).

> 이 이벤트는 **연출 동기화 전용**이라 유실돼도 진행이 갈리지 않는다. 서버는 여기서도 의미를
> 모른 채 슬러그를 다음 스냅샷에 한 번 실어 중계할 뿐이라, **아이템을 늘려도 서버 재배포가 없다.**
