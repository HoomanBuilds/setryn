"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Chip, DeskTabs, Panel, PanelHead, TabBody, TH } from "@/components/strategies/desk/Desk";
import { CopyButton } from "./KeyPanels";

const SNIPPETS = {
  install: {
    label: "Install",
    code: `# In this workspace
pnpm add @setryn/sdk --filter <your-package>

# Run the bundled examples against the local deployment
export SETRYN_API_KEY=stk_test_...        # from "Create API key"
export SETRYN_BASE_URL=http://localhost:3100
pnpm --filter @setryn/sdk example:read`,
  },
  read: {
    label: "Read",
    code: `import { SetrynClient } from "@setryn/sdk";

const setryn = new SetrynClient({
  apiKey: process.env.SETRYN_API_KEY!,
  baseUrl: "http://localhost:3100",
});

const status = await setryn.status();          // chain, head, evidence, onchainMarkets
const { data: markets } = await setryn.listMarkets({ execution: "ONCHAIN" });
// Every onchain market has its own series, book and price grid:
// priceTicks = price x market.onchain.priceScale
const book = await setryn.getBook("XAUUSD-FW-29JUN27");
for await (const fill of setryn.paginate((page) =>
  setryn.listFills({ signer: "0xYourSigner" }, page))) {
  console.log(fill.fillId, fill.filledLots, fill.price);
}`,
  },
  trade: {
    label: "Trade",
    code: `import { SetrynClient, placeOrder } from "@setryn/sdk";
import { createPublicClient, createWalletClient, http } from "viem";

// Your wallet signs; the API never sees a private key.
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
const client = createPublicClient({ chain, transport: http(rpcUrl) });

const result = await placeOrder(setryn, wallet, client, {
  signer: account.address,
  marketId: "BTC-YC-24DEC26",
  side: "LONG",
  lots: 1,
  limitPrice: 613,
  timeInForce: "IOC",
});
// prepare -> sign EIP-712 locally -> risk admission -> your wallet sends
// bindOrderRisk, registerSignedOrder, matchSeries / placeSeriesOrder
// Any market with execution "ONCHAIN" works the same way, e.g.
// { marketId: "ETH-FC-25SEP26", limitPrice: 439.6 }`,
  },
  rfq: {
    label: "Private RFQ",
    code: `import { SetrynClient, executeRfq } from "@setryn/sdk";

// Firm, capacity-backed quotes from solvers, cleared atomically onchain.
// Your wallet signs the order, the request and the quote selection,
// and sends every transaction; the API never holds a key.
const market = await setryn.getMarket("EURUSD-FW-30DEC26");
const result = await executeRfq(setryn, wallet, client, {
  marketId: market.id,
  side: "LONG",
  lots: 1,
  limitPrice: market.quote.bestAsk,   // worst price you accept
});
console.log(result.quote.price, result.settlement.fillId);
// prepareRfq -> sign order + request -> submitRfq -> send BIND_RISK,
// REGISTER_ORDER, REGISTER_RFQ, OPEN_RFQ -> solicitRfqQuotes ->
// prepareRfqAcceptance -> sign selection -> acceptRfqQuote -> send
// LOCK_SELECTION ... SUBMIT_RFQ -> settleRfq`,
  },
  curl: {
    label: "curl",
    code: `KEY=stk_test_...
curl -s http://localhost:3100/api/v1/markets?limit=2 \\
  -H "Authorization: Bearer $KEY"

# Writes are signed (see Authentication):
BODY='{"signer":"0x…","marketId":"ETH-FC-25SEP26","side":"LONG","lots":1,"limitPrice":439.6}'
TS=$(date +%s); NONCE=$(openssl rand -hex 16)
HK=$(printf %s "$KEY" | openssl dgst -sha256 -r | cut -d' ' -f1)
BH=$(printf %s "$BODY" | openssl dgst -sha256 -r | cut -d' ' -f1)
SIG=$(printf 'SETRYN-HMAC-SHA256-V1\\nPOST\\n/api/v1/orders/prepare\\n%s\\n%s\\n%s' "$TS" "$NONCE" "$BH" \\
  | openssl dgst -sha256 -mac HMAC -macopt hexkey:$HK -r | cut -d' ' -f1)
curl -s -X POST http://localhost:3100/api/v1/orders/prepare \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -H "Setryn-Timestamp: $TS" -H "Setryn-Nonce: $NONCE" -H "Setryn-Signature: $SIG" \\
  -d "$BODY"`,
  },
} as const;

type SnippetId = keyof typeof SNIPPETS;

export function QuickstartPanel() {
  const [tab, setTab] = useState<SnippetId>("install");
  const snippet = SNIPPETS[tab];
  return (
    <Panel label="SDK quickstart" delay={60}>
      <PanelHead
        tabs={
          <DeskTabs
            idBase="dev-quickstart"
            value={tab}
            onChange={(id) => setTab(id as SnippetId)}
            items={(Object.keys(SNIPPETS) as SnippetId[]).map((id) => ({ id, label: SNIPPETS[id].label }))}
          />
        }
        tools={<CopyButton value={snippet.code} label={`${snippet.label} snippet`} />}
      />
      <TabBody key={tab} idBase="dev-quickstart">
        <div role="region" tabIndex={0} aria-label={`${snippet.label} code sample`} className="focus-ring scroll-thin max-h-[340px] overflow-auto">
          <pre className="px-3 py-3 font-mono text-[11.5px] leading-[1.6] whitespace-pre text-dim">
            <code>{snippet.code}</code>
          </pre>
        </div>
      </TabBody>
      <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-faint">
        <span className="font-mono text-dim">@setryn/sdk</span> is ESM with viem as its only dependency. Source and README:{" "}
        <span className="font-mono text-dim">packages/sdk</span>.
      </p>
    </Panel>
  );
}

const ENDPOINTS: { method: "GET" | "POST" | "DELETE"; path: string; scope: string; note: string }[] = [
  { method: "GET", path: "/status", scope: "read", note: "Chain, head block, code-hash evidence" },
  { method: "GET", path: "/markets", scope: "read", note: "Catalog; every runtime market is ONCHAIN, others PREVIEW_ONLY" },
  { method: "GET", path: "/markets/{id}", scope: "read", note: "Series, book, price grid, lot cap and collateral per lot" },
  { method: "GET", path: "/markets/{id}/book", scope: "read", note: "The market's own onchain book, or labelled preview depth" },
  { method: "GET", path: "/markets/{id}/trades", scope: "read", note: "The market's direct-book fills, newest first" },
  { method: "GET", path: "/accounts/{accountId}", scope: "read", note: "Posted, reserved and available collateral" },
  { method: "GET", path: "/accounts/{accountId}/positions", scope: "read", note: "Live positions" },
  { method: "GET", path: "/orders", scope: "read", note: "By accountId or signer; filter by state" },
  { method: "GET", path: "/orders/{orderHash}", scope: "read", note: "One registered order" },
  { method: "GET", path: "/fills", scope: "read", note: "Account fills with fees and outcome" },
  { method: "GET", path: "/receipts", scope: "read", note: "Execution receipts" },
  { method: "POST", path: "/orders/prepare", scope: "trade", note: "Unsigned order + EIP-712 typed data" },
  { method: "POST", path: "/orders", scope: "trade", note: "Relay a signed order; returns transactions" },
  { method: "POST", path: "/orders/{orderHash}/cancel", scope: "trade", note: "Cancel transactions + risk-release message" },
  { method: "POST", path: "/positions/exit/prepare", scope: "trade", note: "Full exit of an offsetting pair, typed data" },
  { method: "POST", path: "/positions/exit", scope: "trade", note: "Relay a signed exit; returns transactions" },
  { method: "GET", path: "/rfqs", scope: "read", note: "Private RFQs by accountId or signer" },
  { method: "GET", path: "/rfqs/{rfqId}", scope: "read", note: "One RFQ with its quotes and fills" },
  { method: "GET", path: "/rfqs/{rfqId}/quotes", scope: "read", note: "Quotes, best price first, with withinLimit" },
  { method: "POST", path: "/rfqs/prepare", scope: "trade", note: "Unsigned RFQ order + request typed data" },
  { method: "POST", path: "/rfqs", scope: "trade", note: "Relay a signed RFQ; returns transactions" },
  { method: "POST", path: "/rfqs/{rfqId}/quotes", scope: "trade", note: "Invite solvers to quote a collecting RFQ" },
  { method: "POST", path: "/rfqs/{rfqId}/accept/prepare", scope: "trade", note: "Unsigned quote selection typed data" },
  { method: "POST", path: "/rfqs/{rfqId}/accept", scope: "trade", note: "Relay a signed selection; returns transactions" },
  { method: "POST", path: "/rfqs/{rfqId}/settle", scope: "trade", note: "Executor clears the submitted RFQ atomically" },
  { method: "POST", path: "/rfqs/{rfqId}/cancel", scope: "trade", note: "Cancel an unselected RFQ + risk release" },
];

export function EndpointsPanel() {
  return (
    <Panel label="Endpoints" delay={100}>
      <PanelHead
        title="Endpoints"
        tools={
          <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1 rounded-sm text-[11px] text-brand hover:underline">
            OpenAPI 3.1 JSON
            <ExternalLink size={11} aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        }
      />
      <div role="region" tabIndex={0} aria-label="API endpoints" className="focus-ring scroll-thin max-h-[420px] overflow-auto">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <caption className="sr-only">Version 1 endpoints under /api/v1 with the scope each needs</caption>
          <thead className="sticky top-0 z-[1] bg-panel">
            <tr className="border-b border-line">
              <th className={TH}>Endpoint</th>
              <th className={TH}>Scope</th>
              <th className={TH}>Returns</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((endpoint) => (
              <tr key={`${endpoint.method} ${endpoint.path}`} className="border-b border-line-soft">
                <td className="px-3 py-1.5 font-mono text-[11px] whitespace-nowrap text-ink">
                  <span className={`mr-1.5 inline-block w-10 ${endpoint.method === "GET" ? "text-faint" : "text-brand"}`}>{endpoint.method}</span>
                  /api/v1{endpoint.path}
                </td>
                <td className="px-3 py-1.5">
                  <Chip tone={endpoint.scope === "trade" ? "brand" : "dim"}>{endpoint.scope}</Chip>
                </td>
                <td className="px-3 py-1.5 text-dim">{endpoint.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function AuthPanel() {
  return (
    <Panel label="Authentication and limits" delay={120}>
      <PanelHead title="Authentication and limits" />
      <dl className="divide-y divide-line-soft text-xs">
        {[
          ["Authentication", "Authorization: Bearer stk_test_<id>_<secret>. Scopes read and trade; optional signer allowlist."],
          ["Rate limits", "Token bucket per key. RateLimit-Limit, -Remaining, -Reset and -Policy on every response; 429 with Retry-After."],
          ["Replay protection", "Writes need Setryn-Timestamp (±60s), a single-use Setryn-Nonce, and Setryn-Signature."],
          ["Signature", "hex HMAC-SHA256, key = SHA-256(apiKey), over SETRYN-HMAC-SHA256-V1, method, path?query, timestamp, nonce, SHA-256(body), newline-joined."],
          ["Errors", "{ error: { code, message } } with stable codes, plus Setryn-Request-Id for support."],
          ["Versioning", "Major version in the path. Breaking changes ship as /api/v2 with at least 90 days of v1 overlap and Deprecation/Sunset headers."],
        ].map(([label, value]) => (
          <div key={label} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-3">
            <dt className="text-faint">{label}</dt>
            <dd className="leading-relaxed text-dim">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export function SignersPanel() {
  return (
    <Panel label="Delegated signers" delay={140}>
      <PanelHead title="Delegated signers" tools={<Chip tone="neutral">Not onchain yet</Chip>} />
      <div className="grid gap-2 px-3 py-3 text-xs leading-relaxed text-dim">
        <p>
          Orders are signed by the account owner. The collateral vault derives the account from the signer, and risk admission refuses an order whose
          signer does not own the account, so a separate session or bot key cannot trade an account today.
        </p>
        <p>
          What is enforced now: an API key can be restricted to specific signer addresses, and the API never holds a private key. Every order is signed
          in your wallet, and every transaction is sent by it.
        </p>
        <p className="text-faint">Onchain delegated signers with per-signer limits need a contract change and are not available in v1.</p>
      </div>
    </Panel>
  );
}

export function WebhooksPanel() {
  return (
    <Panel label="Webhooks" delay={160}>
      <PanelHead title="Webhooks" />
      <div className="grid gap-2 px-3 py-3 text-xs leading-relaxed text-dim">
        <p>Push delivery of fills, order state and receipts to your endpoint is documented under the webhooks API.</p>
        <Link
          href="/api/v1/webhooks"
          prefetch={false}
          className="focus-ring inline-flex w-fit items-center gap-1 rounded-sm font-mono text-[11px] text-brand hover:underline"
        >
          /api/v1/webhooks
          <ExternalLink size={11} aria-hidden="true" />
        </Link>
      </div>
    </Panel>
  );
}
