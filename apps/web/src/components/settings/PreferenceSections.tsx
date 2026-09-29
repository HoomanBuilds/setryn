"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Lock, ShieldOff } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { BUTTON_GHOST, ConnectWalletButton, ProvenanceChip, StateDot } from "@/components/home/kit";
import { Chip, Panel, PanelHead, Row, Switch, TH } from "@/components/strategies/desk/Desk";
import { Segmented } from "@/components/terminal/primitives";
import {
  DEFAULT_CONFIRMATIONS,
  DEFAULT_DISCLOSURE,
  DEFAULT_SIZE_UNIT,
  LOCAL_KEYS,
  SLIPPAGE_PRESETS_BPS,
  useConfirmationPrefs,
  useDisclosurePrefs,
  useSizeUnit,
  useSlippagePreference,
  type ConfirmationPrefs,
  type DisclosurePrefs,
  type SizeUnit,
} from "@/lib/settings/preferences";
import { WRITE_POLICY, shortHex } from "@/lib/settings/organization";

function Setting({
  title,
  detail,
  consumer,
  children,
}: {
  title: string;
  detail: string;
  consumer: { label: string; live: boolean };
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 border-b border-line-soft px-3 py-3 last:border-b-0 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,340px)] md:items-center md:gap-6">
      <div className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink">{title}</span>
          <Chip
            tone={consumer.live ? "dim" : "neutral"}
            title={consumer.live ? "Another surface reads this value now." : "Stored for this viewer; the named surface has not adopted it yet."}
          >
            {consumer.label}
          </Chip>
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-faint">{detail}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function TradingSection() {
  const [unit, setUnit] = useSizeUnit();
  const [slippage, setSlippage] = useSlippagePreference();
  const [confirmations, setConfirmations] = useConfirmationPrefs();
  const toggle = (key: keyof ConfirmationPrefs) => (next: boolean) => setConfirmations((current) => ({ ...current, [key]: next }));
  const rows: { key: keyof ConfirmationPrefs; label: string; detail: string }[] = [
    { key: "orders", label: "Placing orders", detail: "Review sheet before the wallet prompt." },
    { key: "cancels", label: "Cancelling orders", detail: "Confirm before cancel-all and single cancels." },
    { key: "rfqSelection", label: "Selecting an RFQ quote", detail: "Confirm the maker, price, and capacity reservation." },
    { key: "collateral", label: "Moving collateral", detail: "Confirm deposits and withdrawals." },
  ];
  return (
    <div className="flex flex-col gap-1">
      <Panel label="Order defaults">
        <PanelHead title="Order defaults" tools={<Chip tone="neutral">This browser</Chip>} />
        <Setting
          title="Market-order slippage"
          detail="Worst price a market order accepts, moved against you from the live executable route. The terminal applies it at least one tick wide."
          consumer={{ label: "Read by trade terminal", live: true }}
        >
          <Segmented
            options={SLIPPAGE_PRESETS_BPS.map((value) => ({ value: String(value), label: `${value} bp` }))}
            value={String(slippage)}
            onChange={(value) => setSlippage(Number(value))}
            label="Market-order slippage"
            size="sm"
          />
        </Setting>
        <Setting
          title="Default size unit"
          detail="How package size reads on Home and in exposure coverage: contract lots or USDC notional."
          consumer={{ label: "Read by Home, Exposures", live: true }}
        >
          <Segmented
            options={[
              { value: "LOTS" as SizeUnit, label: "Lots" },
              { value: "NOTIONAL" as SizeUnit, label: "USDC notional" },
            ]}
            value={unit}
            onChange={setUnit}
            label="Default size unit"
            size="sm"
          />
        </Setting>
      </Panel>

      <Panel label="Confirmation prompts" delay={40}>
        <PanelHead title="Confirmation prompts" tools={<Chip tone="neutral" title="Stored for this viewer. The order ticket has not adopted these prompts yet.">Pending adoption</Chip>} />
        <ul>
          {rows.map((row) => (
            <li key={row.key} className="flex min-h-[52px] items-center justify-between gap-4 border-b border-line-soft px-3 py-2 last:border-b-0">
              <span className="min-w-0">
                <span className="block text-xs text-ink">{row.label}</span>
                <span className="block text-[11px] text-faint">{row.detail}</span>
              </span>
              <span className="grid h-11 w-11 place-items-center lg:h-auto lg:w-auto">
                <Switch checked={confirmations[row.key]} onChange={toggle(row.key)} label={`Confirm before ${row.label.toLowerCase()}`} tone="brand" />
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-faint">
          The wallet signature is always a separate step. Success is shown only when the protocol reaches the action&apos;s
          terminal state, never at signature.
        </p>
      </Panel>
    </div>
  );
}

/** visible: the audience sees it; private: committed or masked; hidden: not disclosed at all. */
type Cell = { text: string; tone: "private" | "hidden" | "visible" };

/** The private RFQ flow under the viewer's identity and size defaults. */
function visibility(prefs: DisclosurePrefs): { label: string; cells: Cell[] }[] {
  const hidden: Cell = { text: "Hidden", tone: "hidden" };
  return [
    {
      label: "Package and legs",
      cells: [{ text: "Visible", tone: "visible" }, hidden, { text: "Commitment hash", tone: "private" }, { text: "Receipt", tone: "visible" }],
    },
    {
      label: "Size",
      cells: [
        prefs.size === "EXACT" ? { text: "Exact", tone: "visible" } : { text: "Size band", tone: "private" },
        hidden,
        { text: "Commitment hash", tone: "private" },
        { text: "Filled size", tone: "visible" },
      ],
    },
    {
      label: "Requesting account",
      cells: [
        prefs.identity === "ANONYMOUS" ? { text: "Anonymous session", tone: "private" } : { text: "Account id", tone: "visible" },
        hidden,
        { text: "At clearing", tone: "visible" },
        { text: "Counterparty", tone: "visible" },
      ],
    },
    {
      label: "Your limit price",
      cells: [hidden, hidden, { text: "In signed bound", tone: "private" }, { text: "Fill price only", tone: "hidden" }],
    },
    {
      label: "Competing quotes",
      cells: [{ text: "Own quote only", tone: "private" }, hidden, { text: "Selected quote", tone: "visible" }, { text: "Winning price", tone: "visible" }],
    },
  ];
}

const CELL_TONE = { private: "text-dim", hidden: "text-faint", visible: "text-ink" } as const;

export function PrivacySection() {
  const [prefs, setPrefs] = useDisclosurePrefs();
  const set = <K extends keyof DisclosurePrefs>(key: K) => (value: DisclosurePrefs[K]) => setPrefs((current) => ({ ...current, [key]: value }));
  const matrix = visibility(prefs);
  return (
    <div className="flex flex-col gap-1">
      <Panel label="RFQ disclosure defaults">
        <PanelHead title="RFQ disclosure defaults" tools={<Chip tone="neutral" title="Stored for this viewer. The RFQ ticket has not adopted these defaults yet.">Pending adoption</Chip>} />
        <Setting title="Default route" detail="Where a new ticket starts. A private RFQ keeps the package off the public book until clearing." consumer={{ label: "Order ticket", live: false }}>
          <Segmented
            options={[
              { value: "PUBLIC_BOOK" as const, label: "Public book" },
              { value: "PRIVATE_RFQ" as const, label: "Private RFQ" },
            ]}
            value={prefs.route}
            onChange={set("route")}
            label="Default route"
            size="sm"
          />
        </Setting>
        <Setting title="Identity to makers" detail="Whether invited makers see your account id or an anonymous session while quoting." consumer={{ label: "RFQ ticket", live: false }}>
          <Segmented
            options={[
              { value: "ANONYMOUS" as const, label: "Anonymous" },
              { value: "ACCOUNT" as const, label: "Account id" },
            ]}
            value={prefs.identity}
            onChange={set("identity")}
            label="Identity to makers"
            size="sm"
          />
        </Setting>
        <Setting title="Size to makers" detail="Exact size tightens quotes; a band hides your exact size until selection." consumer={{ label: "RFQ ticket", live: false }}>
          <Segmented
            options={[
              { value: "EXACT" as const, label: "Exact" },
              { value: "BANDED" as const, label: "Size band" },
            ]}
            value={prefs.size}
            onChange={set("size")}
            label="Size to makers"
            size="sm"
          />
        </Setting>
      </Panel>

      <Panel label="Visibility matrix" delay={40}>
        <PanelHead title="Who sees what in a private RFQ" tools={<ProvenanceChip kind="MODELED" title="Describes the disclosure policy under these defaults; it is not a live disclosure check." />} />
        <div className="scroll-thin overflow-x-auto">
          <table className="relative w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">Visibility of each order attribute by audience under the current defaults</caption>
            <thead>
              <tr className="border-b border-line">
                <th className={TH}>Attribute</th>
                <th className={TH}>Invited makers</th>
                <th className={TH}>Other makers</th>
                <th className={TH}>Onchain before fill</th>
                <th className={TH}>After execution</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.label} className="h-9 border-b border-line-soft last:border-b-0">
                  <td className="px-3 text-xs text-dim">{row.label}</td>
                  {row.cells.map((cell, index) => (
                    <td key={index} className={`px-3 text-xs ${CELL_TONE[cell.tone]}`}>
                      <span className="inline-flex items-center gap-1.5">
                        {cell.tone === "private" ? <Lock size={11} aria-label="Private" className="shrink-0 text-faint" /> : null}
                        {cell.text}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-faint">
          The lock marks what stays masked or is committed only as a hash. A public book order shows its package,
          price, and size to everyone once it rests. Receipts publish the executed package, size, and price so
          settlement can be verified.
        </p>
      </Panel>
    </div>
  );
}

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener("setryn:persistent-state", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("setryn:persistent-state", onChange);
  };
}

function storedKeys(): string {
  try {
    return LOCAL_KEYS.filter((item) => window.localStorage.getItem(item.key) !== null)
      .map((item) => item.key)
      .join("|");
  } catch {
    return "";
  }
}

export function SecuritySection() {
  const snapshot = useGatewaySnapshot();
  const [, setUnit] = useSizeUnit();
  const [, setConfirmations] = useConfirmationPrefs();
  const [, setDisclosure] = useDisclosurePrefs();
  const present = useSyncExternalStore(subscribeStorage, storedKeys, () => "");
  const stored = new Set(present.split("|").filter(Boolean));
  const connected = snapshot.wallet.status === "CONNECTED" && snapshot.wallet.address;
  const reset = () => {
    setUnit(DEFAULT_SIZE_UNIT);
    setConfirmations(DEFAULT_CONFIRMATIONS);
    setDisclosure(DEFAULT_DISCLOSURE);
  };
  return (
    <div className="flex flex-col gap-1">
      <Panel label="Signing authority">
        <PanelHead title="Signing authority" tools={<ProvenanceChip kind="OBSERVED" title="Read from the connected wallet and gateway." />} />
        <div className="px-3 py-2">
          <Row label="Wallet" value={connected ? shortHex(snapshot.wallet.address ?? "") : "Not connected"} tone={connected ? "neutral" : "dim"} />
          <Row label="Network" value={`${snapshot.environment.label} / chain ${snapshot.wallet.chainId ?? snapshot.environment.chainId}`} tone="dim" />
          <Row label="Order authority" value="Wallet signs every order" tone="dim" />
          <Row label="Delegated signers" value="None" tone="dim" />
          <Row label="API sessions" value="None" tone="dim" />
        </div>
        {!connected ? (
          <div className="border-t border-line-soft px-3 py-3">
            <ConnectWalletButton />
          </div>
        ) : null}
        <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-faint">
          No private key, delegated authority, or quote secret is stored by this page or sent in notifications. Delegated
          signers and API sessions arrive with the developer console, after the trading platform.
        </p>
      </Panel>

      <Panel label="Environment write policy" delay={40}>
        <PanelHead title="Environment write policy" tools={<Chip tone="neutral" title="Mirrors OrganizationControlWritePolicy in the organization-control service">Control policy</Chip>} />
        <ul>
          {WRITE_POLICY.map((item) => (
            <li key={item.environment} className="flex min-h-[48px] items-center justify-between gap-4 border-b border-line-soft px-3 py-2 last:border-b-0">
              <span className="flex min-w-0 items-center gap-2.5">
                {item.allowed ? <Lock size={13} aria-hidden="true" className="shrink-0 text-dim" /> : <ShieldOff size={13} aria-hidden="true" className="shrink-0 text-down" />}
                <span className="min-w-0">
                  <span className="block text-xs text-ink">{item.label}</span>
                  <span className="block text-[11px] text-faint">{item.reason}</span>
                </span>
              </span>
              <span className={`shrink-0 text-xs ${item.allowed ? "text-dim" : "text-down"}`}>{item.allowed ? "Writes permitted" : "Writes disabled"}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel label="Data in this browser" delay={80}>
        <PanelHead
          title="Data in this browser"
          tools={
            <button type="button" onClick={reset} className={`${BUTTON_GHOST} lg:h-7`}>
              Reset preferences
            </button>
          }
        />
        <ul>
          {LOCAL_KEYS.map((item) => (
            <li key={item.key} className="flex min-h-[40px] items-center justify-between gap-3 border-b border-line-soft px-3 py-1.5 last:border-b-0">
              <span className="min-w-0">
                <span className="block text-xs text-dim">{item.label}</span>
                <span className="tnum block truncate font-mono text-[10.5px] text-off">{item.key}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] text-faint">
                <span className="hidden sm:inline">{item.owner}</span>
                <span className="inline-flex items-center gap-1.5">
                  <StateDot tone={stored.has(item.key) ? "up" : "dim"} />
                  {stored.has(item.key) ? "Stored" : "Default"}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-faint">
          Preferences, the exposure book, and alert state stay in this browser. Nothing here is sent to Setryn or shared
          with other viewers.
        </p>
      </Panel>
    </div>
  );
}
