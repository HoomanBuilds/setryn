const whole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function usd(value: number): string {
  return whole.format(value);
}

export function signedUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}${whole.format(Math.abs(value))}`;
}

/** $10k, $1.25M: compact dollars for dense ladder cells. */
export function usdCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Number((abs / 1_000).toFixed(1))}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function signedNumber(value: number, digits = 0): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(digits)}`;
}
