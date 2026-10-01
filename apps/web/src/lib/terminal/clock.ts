/**
 * The platform clock: the browser clock corrected to the settlement chain's clock. A local chain can run ahead of or
 * behind wall time, so order deadlines, RFQ expiries, expiry countdowns, and chart bars read chain time rather than
 * wall time. Without a connected chain the offset is zero and this is the wall clock.
 */
let chainOffsetMs = 0;

export function setChainClockOffset(offsetMs: number): void {
  chainOffsetMs = offsetMs;
}

export function platformNow(): number {
  return Date.now() + chainOffsetMs;
}
