import type { ApplicationDataAdapter } from "../ports.ts";
import type { ApplicationDataSlice, ApplicationViewQuery } from "../types.ts";

export type LocalApplicationFixture = Omit<ApplicationDataSlice, "status"> & {
  readonly status: Omit<ApplicationDataSlice["status"], "environment" | "chainId" | "writeMode" | "writeDisabledReason">;
};

export class LocalFixtureApplicationAdapter implements ApplicationDataAdapter {
  readonly environment = "local" as const;
  readonly #fixture: LocalApplicationFixture;
  readonly #chainId: 31337 | 1337;

  constructor(fixture: LocalApplicationFixture, chainId: 31337 | 1337 = 31337) {
    this.#fixture = structuredClone(fixture);
    this.#chainId = chainId;
  }

  async load(query: ApplicationViewQuery): Promise<ApplicationDataSlice> {
    if (query.environment !== this.environment) throw new Error("local fixture adapter received the wrong environment");
    const fixture = structuredClone(this.#fixture);
    const account = query.accountId === undefined || fixture.indexed.account?.accountId === query.accountId
      ? fixture.indexed.account
      : null;
    const marketIds = query.marketIds === undefined ? null : new Set(query.marketIds);
    return {
      ...fixture,
      status: {
        ...fixture.status,
        environment: this.environment,
        chainId: this.#chainId,
        writeMode: "enabled",
        writeDisabledReason: null,
      },
      markets: fixture.markets.filter(({ marketId }) => !marketIds || marketIds.has(marketId)),
      indexed: {
        ...fixture.indexed,
        account,
        provenance: fixture.indexed.provenance.map((entry) => ({ ...entry, chainId: this.#chainId })),
      },
      provenance: fixture.provenance.map((entry) => ({ ...entry, chainId: this.#chainId })),
    };
  }
}
