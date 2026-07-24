/// <reference types="vite/client" />

/* 빌드 타임 환경변수 — Vite가 번들에 값을 박아 넣는다(.env / 배포 플랫폼 설정).
   VITE_ 접두사가 붙은 것만 클라이언트에 노출된다. 비밀값은 절대 넣지 말 것. */
interface ImportMetaEnv {
  /** 게임 서버 주소(호스트까지만). 배포 시 필수(예: wss://arcade-server.example.com).
   *  비워두면 로컬 개발 기본값(ws://<현재 호스트>:8787 — `npm run dev:server`)을 쓴다.
   *  방 만들기용 HTTP 주소는 이 값에서 ws→http로 유도하므로 따로 설정하지 않는다. */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
