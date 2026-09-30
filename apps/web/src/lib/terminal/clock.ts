/**
 * The platform clock: the browser clock corrected to the settlement chain's clock. The local devnet runs on the
 * preview scenario clock, so order deadlines, RFQ expiries, and countdowns read chain time rather than wall time.
 * Without a connected chain the offset is zero and this is the wall clock.
 */
let chainOffsetMs = 0;

export function setChainClockOffset(offsetMs: number): void {
  chainOffsetMs = offsetMs;
}

export function platformNow(): number {
  return Date.now() + chainOffsetMs;
}
