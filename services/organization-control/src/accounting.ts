import {
  assertBytes32,
  assertIsoTimestamp,
  assertNonEmpty,
  organizationControlJournalVersion,
  type AccountingJournal,
  type CompletedPackageExecution,
  type ExecutionLegInput,
  type JournalEntry,
  type JournalExport,
} from "./types.ts";

const SCALE = 1000000000000000000n;
const AMOUNT_PATTERN = /^(\d+)(?:\.(\d{1,18}))?$/;

export function parseScaledAmount(amount: string): bigint {
  const match = AMOUNT_PATTERN.exec(amount);
  if (match === null) throw new TypeError(`amount ${amount} must be a non-negative decimal with up to 18 places`);
  const scaled = BigInt(match[1]) * SCALE + BigInt((match[2] ?? "").padEnd(18, "0"));
  if (scaled <= 0n) throw new RangeError("amount must be greater than zero");
  return scaled;
}

export function formatScaledAmount(scaled: bigint): string {
  if (scaled <= 0n) throw new RangeError("scaled amount must be greater than zero");
  const whole = scaled / SCALE;
  const fraction = (scaled % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}

export function buildAccountingJournal(
  input: CompletedPackageExecution,
  journalId: string,
  postedAt: string,
): AccountingJournal {
  assertNonEmpty(journalId, "journalId");
  assertNonEmpty(input.executionId, "executionId");
  assertBytes32(input.organizationId, "organizationId");
  assertBytes32(input.accountId, "accountId");
  assertBytes32(input.marketId, "marketId");
  assertBytes32(input.packageHash, "packageHash");
  assertBytes32(input.receiptId, "receiptId");
  assertBytes32(input.transactionHash, "transactionHash");
  assertIsoTimestamp(input.completedAt, "completedAt");
  assertIsoTimestamp(postedAt, "postedAt");
  if (input.legs.length === 0) throw new TypeError("execution must include at least one leg");
  const legIds = input.legs.map((leg) => assertNonEmpty(leg.legId, "legId"));
  if (new Set(legIds).size !== legIds.length) throw new TypeError("execution leg ids must be unique");
  const legs = [...input.legs].sort((a, b) => a.legId.localeCompare(b.legId));
  const debits = new Map<string, bigint>();
  const credits = new Map<string, bigint>();
  const entries = legs.map((leg) => validatedEntry(input, journalId, postedAt, leg, debits, credits));
  assertBalanced(debits, credits);
  return {
    journalId,
    exportVersion: organizationControlJournalVersion,
    organizationId: input.organizationId,
    executionId: input.executionId,
    packageHash: input.packageHash,
    receiptId: input.receiptId,
    transactionHash: input.transactionHash,
    postedAt,
    entries,
    totals: totalsOf(debits),
  };
}

export function exportAccountingJournal(journal: AccountingJournal): JournalExport {
  if (journal.exportVersion !== organizationControlJournalVersion) {
    throw new TypeError(`unsupported journal export version ${journal.exportVersion}`);
  }
  const entries = [...journal.entries]
    .sort((a, b) => a.entryId.localeCompare(b.entryId))
    .map((entry) => ({ ...entry }));
  const totals: Record<string, string> = {};
  for (const currency of Object.keys(journal.totals).sort()) {
    totals[currency] = journal.totals[currency];
  }
  return {
    exportVersion: journal.exportVersion,
    journalId: journal.journalId,
    organizationId: journal.organizationId,
    executionId: journal.executionId,
    packageHash: journal.packageHash,
    receiptId: journal.receiptId,
    transactionHash: journal.transactionHash,
    postedAt: journal.postedAt,
    entries,
    totals,
  };
}

function validatedEntry(
  input: CompletedPackageExecution,
  journalId: string,
  postedAt: string,
  leg: ExecutionLegInput,
  debits: Map<string, bigint>,
  credits: Map<string, bigint>,
): JournalEntry {
  assertNonEmpty(leg.debitAccount, "debitAccount");
  assertNonEmpty(leg.creditAccount, "creditAccount");
  if (leg.debitAccount === leg.creditAccount) {
    throw new TypeError(`leg ${leg.legId} must debit and credit different accounts`);
  }
  assertNonEmpty(leg.currency, "currency");
  const scaled = parseScaledAmount(leg.amount);
  debits.set(leg.currency, (debits.get(leg.currency) ?? 0n) + scaled);
  credits.set(leg.currency, (credits.get(leg.currency) ?? 0n) + scaled);
  return {
    entryId: `${journalId}:${leg.legId}`,
    journalId,
    organizationId: input.organizationId,
    accountId: input.accountId,
    marketId: input.marketId,
    debitAccount: leg.debitAccount,
    creditAccount: leg.creditAccount,
    amount: leg.amount,
    currency: leg.currency,
    executionId: input.executionId,
    packageHash: input.packageHash,
    receiptId: input.receiptId,
    transactionHash: input.transactionHash,
    postedAt,
  };
}

function assertBalanced(debits: Map<string, bigint>, credits: Map<string, bigint>): void {
  const currencies = new Set([...debits.keys(), ...credits.keys()]);
  for (const currency of currencies) {
    if ((debits.get(currency) ?? 0n) !== (credits.get(currency) ?? 0n)) {
      throw new Error(`journal is unbalanced in ${currency}`);
    }
  }
}

function totalsOf(debits: Map<string, bigint>): Record<string, string> {
  const totals: Record<string, string> = {};
  for (const currency of [...debits.keys()].sort()) {
    totals[currency] = formatScaledAmount(debits.get(currency) as bigint);
  }
  return totals;
}
