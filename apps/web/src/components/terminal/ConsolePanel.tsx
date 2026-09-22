"use client";

import type { ReactNode } from "react";
import { EmptyState, SOURCE_LABEL, SourceMark, Tabs } from "@/components/terminal/primitives";
import { CONSOLE, CONSOLE_TABS } from "@/lib/terminal/console";
import { formatDuration, formatLots, formatSignedUsd } from "@/lib/terminal/format";
import type { ConsoleTabId, PackageMarket } from "@/lib/terminal/types";

const ADVERSE = new Set(["REJECTED", "SUBMISSION_UNKNOWN", "RECONCILING", "EXPIRED", "CANCELLED"]);

function stateLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function State({ value }: { value: string }) {
  return (
    <span className={ADVERSE.has(value) ? "text-down" : "text-dim"}>{stateLabel(value)}</span>
  );
}

const TH = "px-3 py-2 text-left font-normal whitespace-nowrap";
const TD = "px-3 py-2.5 align-top";
const NUM = "tnum px-3 py-2.5 text-right align-top font-mono text-ink whitespace-nowrap";

function Table({
  minWidth,
  head,
  children,
}: {
  minWidth: number;
  head: { label: string; numeric?: boolean }[];
  children: ReactNode;
}) {
  return (
    <div className="scroll-thin h-full min-w-0 overflow-auto">
      <table
        className="w-full border-collapse text-xs"
        style={{ minWidth: `${minWidth}px` }}
      >
        <thead className="sticky top-0 z-10 bg-panel text-faint">
          <tr className="border-b border-line">
            {head.map((cell) => (
              <th
                key={cell.label}
                scope="col"
                className={`${TH} ${cell.numeric ? "text-right" : ""}`}
              >
                {cell.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

function Tr({ highlight, children }: { highlight: boolean; children: ReactNode }) {
  return <tr className={highlight ? "bg-raised/50" : undefined}>{children}</tr>;
}

export function ConsolePanel({
  market,
  tab,
  onTab,
  scoped,
  onScopedChange,
}: {
  market: PackageMarket;
  tab: ConsoleTabId;
  onTab: (tab: ConsoleTabId) => void;
  scoped: boolean;
  onScopedChange: (scoped: boolean) => void;
}) {
  const keep = <T extends { marketId: string }>(rows: T[]) =>
    scoped ? rows.filter((row) => row.marketId === market.id) : rows;

  const strategies = keep(CONSOLE.strategies);
  const orders = keep(CONSOLE.orders);
  const rfqs = keep(CONSOLE.rfqs);
  const fills = keep(CONSOLE.fills);
  const recovery = keep(CONSOLE.recovery);
  const receipts = keep(CONSOLE.receipts);

  const counts: Record<ConsoleTabId, number> = {
    strategies: strategies.length,
    orders: orders.length,
    rfqs: rfqs.length,
    fills: fills.length,
    recovery: recovery.length,
    receipts: receipts.length,
  };

  const empty = (
    <EmptyState>
      <span>
        {`No ${tab} for ${market.name} in this preview set. `}
        <button
          type="button"
          onClick={() => onScopedChange(false)}
          className="focus-ring rounded-sm text-ink underline underline-offset-2"
        >
          Show all markets
        </button>
      </span>
    </EmptyState>
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-line bg-panel">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line pr-3 lg:pr-4">
        <Tabs
          items={CONSOLE_TABS.map((item) => ({ ...item, badge: counts[item.id] }))}
          value={tab}
          onChange={(id) => onTab(id as ConsoleTabId)}
          idBase="console"
          className="no-scrollbar min-w-0 overflow-x-auto"
        />
        <button
          type="button"
          onClick={() => onScopedChange(!scoped)}
          aria-pressed={scoped}
          className="focus-ring hidden h-7 shrink-0 rounded-sm px-2 text-xs text-dim transition-colors hover:text-ink sm:block"
        >
          {scoped ? `Scoped to ${market.name}` : "All markets"}
        </button>
      </div>

      <div
        id={`console-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`console-tab-${tab}`}
        className="min-h-0 min-w-0 flex-1"
      >
        {tab === "strategies" ? (
          strategies.length === 0 ? (
            empty
          ) : (
            <Table
              minWidth={900}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Lots", numeric: true },
                { label: "Entry", numeric: true },
                { label: "Mark", numeric: true },
                { label: "Unrealised", numeric: true },
                { label: "State" },
                { label: "Next lifecycle event" },
              ]}
            >
              {strategies.map((row) => (
                <Tr key={row.id} highlight={!scoped && row.marketId === market.id}>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>{row.id}</td>
                  <td className={`${TD} whitespace-nowrap text-ink`}>{row.package}</td>
                  <td className={NUM}>{formatLots(row.lots)}</td>
                  <td className={NUM}>{row.entry}</td>
                  <td className={NUM}>{row.mark}</td>
                  <td
                    className={`${NUM} ${row.unrealised >= 0 ? "text-up" : "text-down"}`}
                  >
                    {formatSignedUsd(row.unrealised, 2)}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <State value={row.state} />
                  </td>
                  <td className={`${TD} text-faint`}>{row.nextEvent}</td>
                </Tr>
              ))}
            </Table>
          )
        ) : null}

        {tab === "orders" ? (
          orders.length === 0 ? (
            empty
          ) : (
            <Table
              minWidth={1000}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Side" },
                { label: "Filled", numeric: true },
                { label: "Limit", numeric: true },
                { label: "TIF" },
                { label: "Route" },
                { label: "State" },
                { label: "Detail" },
              ]}
            >
              {orders.map((row) => (
                <Tr key={row.id} highlight={!scoped && row.marketId === market.id}>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>{row.id}</td>
                  <td className={`${TD} whitespace-nowrap text-ink`}>{row.package}</td>
                  <td className={`${TD} whitespace-nowrap text-dim`}>
                    {row.side === "ENTER" ? "Enter" : "Exit"}
                  </td>
                  <td className={NUM}>
                    {`${formatLots(row.filledLots)} / ${formatLots(row.lots)}`}
                  </td>
                  <td className={NUM}>{row.limit}</td>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-dim`}>{row.tif}</td>
                  <td className={`${TD} whitespace-nowrap text-dim`}>{row.route}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <State value={row.state} />
                  </td>
                  <td className={`${TD} text-faint`}>{row.detail}</td>
                </Tr>
              ))}
            </Table>
          )
        ) : null}

        {tab === "rfqs" ? (
          rfqs.length === 0 ? (
            empty
          ) : (
            <Table
              minWidth={980}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Lots", numeric: true },
                { label: "Responses", numeric: true },
                { label: "Best quote" },
                { label: "Closes in", numeric: true },
                { label: "State" },
                { label: "Disclosure" },
              ]}
            >
              {rfqs.map((row) => (
                <Tr key={row.id} highlight={!scoped && row.marketId === market.id}>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>{row.id}</td>
                  <td className={`${TD} whitespace-nowrap text-ink`}>{row.package}</td>
                  <td className={NUM}>{formatLots(row.lots)}</td>
                  <td className={NUM}>{`${row.responded} / ${row.invited}`}</td>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-ink`}>{row.best}</td>
                  <td className={`${NUM} ${row.closesInSeconds > 0 ? "text-dim" : "text-off"}`}>
                    {row.closesInSeconds > 0 ? formatDuration(row.closesInSeconds) : "closed"}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <State value={row.state} />
                  </td>
                  <td className={`${TD} text-faint`}>{row.disclosure}</td>
                </Tr>
              ))}
            </Table>
          )
        ) : null}

        {tab === "fills" ? (
          fills.length === 0 ? (
            empty
          ) : (
            <Table
              minWidth={900}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Side" },
                { label: "Lots", numeric: true },
                { label: "Price", numeric: true },
                { label: "Source" },
                { label: "Fee", numeric: true },
                { label: "Filled at" },
              ]}
            >
              {fills.map((row) => (
                <Tr key={row.id} highlight={!scoped && row.marketId === market.id}>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>{row.id}</td>
                  <td className={`${TD} whitespace-nowrap text-ink`}>{row.package}</td>
                  <td className={`${TD} whitespace-nowrap text-dim`}>
                    {row.side === "ENTER" ? "Enter" : "Exit"}
                  </td>
                  <td className={NUM}>{formatLots(row.lots)}</td>
                  <td className={NUM}>{row.price}</td>
                  <td className={`${TD} whitespace-nowrap text-dim`}>
                    <span className="flex items-center gap-1.5">
                      <SourceMark source={row.source} />
                      {SOURCE_LABEL[row.source]}
                    </span>
                  </td>
                  <td className={NUM}>{row.fee}</td>
                  <td className={`${TD} whitespace-nowrap text-faint`}>{row.at}</td>
                </Tr>
              ))}
            </Table>
          )
        ) : null}

        {tab === "recovery" ? (
          recovery.length === 0 ? (
            empty
          ) : (
            <Table
              minWidth={980}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Stage" },
                { label: "State" },
                { label: "What happened" },
                { label: "Next action" },
              ]}
            >
              {recovery.map((row) => (
                <Tr key={row.id} highlight={!scoped && row.marketId === market.id}>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>{row.id}</td>
                  <td className={`${TD} whitespace-nowrap text-ink`}>{row.package}</td>
                  <td className={`${TD} whitespace-nowrap text-dim`}>{row.stage}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <State value={row.state} />
                  </td>
                  <td className={`${TD} text-faint`}>{row.detail}</td>
                  <td className={`${TD} text-dim`}>{row.nextAction}</td>
                </Tr>
              ))}
            </Table>
          )
        ) : null}

        {tab === "receipts" ? (
          receipts.length === 0 ? (
            empty
          ) : (
            <Table
              minWidth={900}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Receipt kind" },
                { label: "Commitment" },
                { label: "State" },
                { label: "Detail" },
              ]}
            >
              {receipts.map((row) => (
                <Tr key={row.id} highlight={!scoped && row.marketId === market.id}>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>{row.id}</td>
                  <td className={`${TD} whitespace-nowrap text-ink`}>{row.package}</td>
                  <td className={`${TD} whitespace-nowrap text-dim`}>{stateLabel(row.kind)}</td>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-ink`}>
                    {row.commitment}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <State value={row.state} />
                  </td>
                  <td className={`${TD} text-faint`}>{row.detail}</td>
                </Tr>
              ))}
            </Table>
          )
        ) : null}
      </div>
    </section>
  );
}
