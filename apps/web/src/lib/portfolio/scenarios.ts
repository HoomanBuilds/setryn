import type { StressScenario } from "./types";

/**
 * Shocks are relative moves of the package price inside a risk domain, so one
 * scenario applies to every tenor a desk holds without restating a level.
 */
export const SCENARIOS: StressScenario[] = [
  {
    id: "carry-compression",
    label: "Carry compression",
    narrative: "Dated carry collapses toward spot.",
    moves: { CRYPTO_CARRY: -0.6, CRYPTO_BASIS: -0.25, MACRO_FORWARD: -0.08 },
  },
  {
    id: "funding-spike",
    label: "Funding spike",
    narrative: "Funding gaps higher and drags the dated strip.",
    moves: { CRYPTO_CARRY: 0.45, CRYPTO_BASIS: 0.3, MACRO_FORWARD: 0.05 },
  },
  {
    id: "benchmark-dislocation",
    label: "Benchmark dislocation",
    narrative: "A thin benchmark window widens basis.",
    moves: { CRYPTO_CARRY: -0.15, CRYPTO_BASIS: 0.9, MACRO_FORWARD: -0.25 },
  },
  {
    id: "macro-repricing",
    label: "Macro rate gap",
    narrative: "Rate differentials gap, forward points reprice.",
    moves: { CRYPTO_CARRY: -0.12, CRYPTO_BASIS: -0.1, MACRO_FORWARD: -0.65 },
  },
  {
    id: "correlated-risk-off",
    label: "Correlated risk-off",
    narrative: "Every domain sells off together.",
    moves: { CRYPTO_CARRY: -0.55, CRYPTO_BASIS: -0.7, MACRO_FORWARD: -0.5 },
  },
  {
    id: "fixing-gap",
    label: "Fixing session gap",
    narrative: "A near fixing prints away from the mark.",
    moves: { CRYPTO_CARRY: -0.35, CRYPTO_BASIS: -0.2, MACRO_FORWARD: -0.15 },
  },
];
