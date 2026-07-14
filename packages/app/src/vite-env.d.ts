/// <reference types="vite/client" />

/* 빌드 타임 환경변수 — Vite가 번들에 값을 박아 넣는다(.env / 배포 플랫폼 설정).
   VITE_ 접두사가 붙은 것만 클라이언트에 노출된다. 비밀값은 절대 넣지 말 것. */
interface ImportMetaEnv {
  /** 게임 서버 WebSocket 주소. 배포 시 필수(예: wss://arcade-server.example.com).
   *  비워두면 로컬 개발 기본값(ws://<현재 호스트>:8080)을 쓴다. */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
