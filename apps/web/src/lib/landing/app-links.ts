/**
 * Entry points from the public landing into the Setryn platform. The platform is
 * a separate root layout, so these are plain document links rather than client
 * transitions.
 */
export const APP_LINKS = {
  trade: "/trade",
  protect: "/hedges",
  markets: "/markets",
  maker: "/maker",
  portfolio: "/portfolio",
  receipts: "/activity",
} as const;
