import type { StressScenario } from "./types";

/**
 * Stress moves are relative moves of each market's forward level inside a risk domain, applied to the account's real
 * positions at their live marks and clamped into each series' payoff range. They are modeled shocks, not forecasts.
 */
export const SCENARIOS: StressScenario[] = [
  {
    id: "crypto-drawdown",
    label: "Crypto drawdown",
    narrative: "BTC and ETH fall 20%, ARB 30%.",
    moves: { CRYPTO_CARRY: -0.2, CRYPTO_BASIS: -0.3, MACRO_FORWARD: 0 },
  },
  {
    id: "crypto-rally",
    label: "Crypto rally",
    narrative: "BTC and ETH rise 20%, ARB 30%.",
    moves: { CRYPTO_CARRY: 0.2, CRYPTO_BASIS: 0.3, MACRO_FORWARD: 0 },
  },
  {
    id: "dollar-strength",
    label: "Dollar strength",
    narrative: "EUR and gold fall 4% against USD; crypto 5%.",
    moves: { CRYPTO_CARRY: -0.05, CRYPTO_BASIS: -0.05, MACRO_FORWARD: -0.04 },
  },
  {
    id: "dollar-weakness",
    label: "Dollar weakness",
    narrative: "EUR and gold rise 4% against USD; crypto 5%.",
    moves: { CRYPTO_CARRY: 0.05, CRYPTO_BASIS: 0.05, MACRO_FORWARD: 0.04 },
  },
  {
    id: "correlated-risk-off",
    label: "Correlated risk-off",
    narrative: "Crypto falls 35%, ARB 45%, macro forwards 6%.",
    moves: { CRYPTO_CARRY: -0.35, CRYPTO_BASIS: -0.45, MACRO_FORWARD: -0.06 },
  },
  {
    id: "squeeze",
    label: "Short squeeze",
    narrative: "Crypto rises 35%, ARB 45%, macro forwards 6%.",
    moves: { CRYPTO_CARRY: 0.35, CRYPTO_BASIS: 0.45, MACRO_FORWARD: 0.06 },
  },
];
