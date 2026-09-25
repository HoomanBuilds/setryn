import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseCanonicalBlock } from "@setryn/internal-schemas";

import { assertBindingsReady, SetrynProjector } from "../projector.ts";
import { InMemoryProjectionStore } from "../store.ts";

const fixturePath = resolve(process.cwd(), process.argv[2] ?? "services/indexer/fixtures/smoke.json");
const input = JSON.parse(await readFile(fixturePath, "utf8"));
if (!Array.isArray(input)) {
  throw new TypeError("Indexer replay fixture must be an array of canonical blocks");
}

assertBindingsReady();
const store = new InMemoryProjectionStore();
const projector = new SetrynProjector(store);
for (const value of input) {
  projector.ingest(parseCanonicalBlock(value));
}

const state = store.state();
process.stdout.write(
  `${JSON.stringify(
    {
      head: store.head()?.number.toString() ?? null,
      registries: state.registryVersions.size,
      accounts: state.accounts.size,
      balances: state.balances.size,
      locks: state.locks.size,
      terminalReservations: state.terminalReservations.size,
      terminalClaims: state.terminalClaims.size,
      deployments: state.deployments.size,
    },
    null,
    2,
  )}\n`,
);
