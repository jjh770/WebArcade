// `cloudflare:test`는 실제 파일이 아니라 miniflare가 테스트 실행 중에만 넣어 주는
// 가상 모듈이다. 그래서 임포트만으로는 타입이 안 따라오고, 이 선언을 끌어와야 한다.
/// <reference types="@cloudflare/vitest-pool-workers/types" />
