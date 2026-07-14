export type ClockSample = {
  rtt: number;
  receivedAt: number;
  serverTimeAtReceipt: number;
};

export type ClockAnchor = { serverTime: number; performanceTime: number };

/** 왕복 지연이 가장 작은 표본이 비대칭 네트워크 지연의 영향을 가장 적게 받는다. */
export function selectBestClockAnchor(samples: readonly ClockSample[]): ClockAnchor {
  if (samples.length === 0) throw new Error("서버 시각 표본이 없습니다.");
  const best = samples.reduce((a, b) => (a.rtt <= b.rtt ? a : b));
  return { serverTime: best.serverTimeAtReceipt, performanceTime: best.receivedAt };
}

export function serverNowFromAnchor(anchor: ClockAnchor, performanceTime: number): number {
  return anchor.serverTime + (performanceTime - anchor.performanceTime);
}

export function serverTimeToPerformance(anchor: ClockAnchor, serverTime: number): number {
  return anchor.performanceTime + (serverTime - anchor.serverTime);
}
