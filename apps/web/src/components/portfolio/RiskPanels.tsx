"use client";

import {
  Figure,
  FigureGrid,
  NUM,
  Panel,
  ShareBar,
  StackRow,
  StateTag,
  TABLE,
  TD,
  TH,
} from "@/components/portfolio/panels";
import { tone } from "@/components/terminal/primitives";
import {
  formatCompactUsd,
  formatExpiry,
  formatMultiple,
  formatShare,
  formatSignedCompactUsd,
  formatSignedUsd,
  formatUsd,
} from "@/lib/terminal/format";
import type {
  CollateralLine,
  ExposureGroup,
  LadderRung,
  ScenarioResult,
} from "@/lib/portfolio/types";
import type { WithdrawalAvailability } from "@/lib/terminal/account";

const WITHDRAWAL_LABEL: Record<WithdrawalAvailability, string> = {
  IMMEDIATE: "Immediate",
  SCHEDULED: "Scheduled",
  LOCKED: "Locked",
};

/**
 * Wide tables are a desktop instrument. Narrow widths get the same records as
 * stacked rows rather than a squeezed grid behind a horizontal scrollbar, so
 * every figure stays readable and the frame never gains an axis.
 */
const WIDE = "scroll-thin hidden overflow-x-auto lg:block";
const NARROW = "lg:hidden";

export function ExposurePanel({
  groups,
  gross,
  net,
  label,
  aside,
}: {
  groups: ExposureGroup[];
  gross: number;
  net: number;
  label: string;
  aside?: React.ReactNode;
}) {
  return (
    <Panel
      title="Exposure concentration"
      note={`By ${label.toLowerCase()}, package notional`}
      aside={aside}
    >
      <div className={WIDE}>
        <table className={`${TABLE} min-w-[470px] table-fixed`}>
          <caption className="sr-only">
            Gross and net package notional by underlying, with the collateral allocated to each.
          </caption>
          <thead className="bg-panel">
            <tr className="border-b border-line">
              <th scope="col" className={TH}>
                {label}
              </th>
              <th scope="col" className={`${TH} w-[92px] text-right`}>
                Gross
              </th>
              <th scope="col" className={`${TH} w-[100px] text-right`}>
                Net
              </th>
              <th scope="col" className={`${TH} w-[96px] text-right`}>
                Collateral
              </th>
              <th scope="col" className={`${TH} w-[120px] text-right`}>
                Share
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {groups.map((group) => (
              <tr key={group.id}>
                <th scope="row" className={`${TD} h-9 text-left font-normal text-ink`}>
                  <span className="flex items-baseline gap-2">
                    <span className="truncate">{group.label}</span>
                    <span className="shrink-0 text-off">{group.count}</span>
                  </span>
                </th>
                <td className={`${NUM} text-dim`}>{formatCompactUsd(group.gross)}</td>
                <td className={`${NUM} ${tone(group.net)}`}>
                  {formatSignedCompactUsd(group.net)}
                </td>
                <td className={`${NUM} text-dim`}>{formatCompactUsd(group.collateral)}</td>
                <td className={`${NUM} text-dim`}>
                  <span className="flex items-center justify-end gap-2">
                    <ShareBar value={group.share} />
                    <span className="w-[44px] shrink-0 text-right">
                      {formatShare(group.share)}
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-inset">
              <th scope="row" className={`${TD} h-9 text-left font-normal text-dim`}>
                Book
              </th>
              <td className={`${NUM} text-ink`}>{formatCompactUsd(gross)}</td>
              <td className={`${NUM} ${tone(net)}`}>{formatSignedCompactUsd(net)}</td>
              <td className={`${NUM} text-off`} />
              <td className={`${NUM} text-off`}>100.0%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ul className={NARROW}>
        {groups.map((group) => (
          <StackRow key={group.id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[13px] text-ink">{group.label}</span>
                <span className="shrink-0 text-xs text-off">
                  {`${group.count} ${group.count === 1 ? "package" : "packages"}`}
                </span>
              </span>
              <span className="tnum shrink-0 font-mono text-xs text-dim">
                {formatShare(group.share)}
              </span>
            </div>
            <ShareBar value={group.share} />
            <FigureGrid>
              <Figure label="Gross" value={formatCompactUsd(group.gross)} />
              <Figure
                label="Net"
                value={formatSignedCompactUsd(group.net)}
                valueTone={tone(group.net)}
              />
              <Figure label="Collateral" value={formatCompactUsd(group.collateral)} />
            </FigureGrid>
          </StackRow>
        ))}
        <li className="flex items-baseline justify-between gap-3 border-b border-line bg-inset px-3 py-2">
          <span className="text-xs text-faint">Book</span>
          <span className="tnum font-mono text-xs text-dim">
            {`${formatCompactUsd(gross)} gross, `}
            <span className={tone(net)}>{formatSignedCompactUsd(net)}</span>
            {" net"}
          </span>
        </li>
      </ul>
    </Panel>
  );
}

export function ScenarioMatrix({ results }: { results: ScenarioResult[] }) {
  return (
    <Panel title="Scenario risk" note="Modeled shocks, not observed prices">
      <div className={WIDE}>
        <table className={`${TABLE} min-w-[430px] table-fixed`}>
          <caption className="sr-only">
            Modeled package-price shocks by risk domain, with the resulting portfolio impact,
            post-stress headroom over maintenance margin, and health factor. The binding scenario
            is the one that leaves the least headroom.
          </caption>
          <thead className="bg-panel">
            <tr className="border-b border-line">
              <th scope="col" className={TH}>
                Scenario
              </th>
              <th scope="col" className={`${TH} w-[94px] text-right`}>
                Impact
              </th>
              <th scope="col" className={`${TH} w-[102px] text-right`}>
                Headroom
              </th>
              <th scope="col" className={`${TH} w-[62px] text-right`}>
                Health
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {results.map((result) => (
              <tr key={result.scenario.id} className={result.binding ? "bg-raised" : undefined}>
                <th scope="row" className={`${TD} relative py-2 text-left font-normal`}>
                  {result.binding ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 w-[2px] bg-brand"
                    />
                  ) : null}
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-xs text-ink">{result.scenario.label}</span>
                      {result.binding ? (
                        <span className="shrink-0 text-xs text-brand">Binding</span>
                      ) : null}
                    </span>
                    <span className="truncate text-xs text-off" title={result.scenario.narrative}>
                      {result.scenario.narrative}
                    </span>
                  </span>
                </th>
                <td className={`${NUM} ${tone(result.impact)}`}>
                  {formatSignedCompactUsd(result.impact)}
                </td>
                <td className={`${NUM} text-dim`}>{formatCompactUsd(result.headroom)}</td>
                <td className={`${NUM} text-dim`}>{formatMultiple(result.healthFactor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className={NARROW}>
        {results.map((result) => (
          <StackRow key={result.scenario.id}>
            <div className="flex min-w-0 flex-col">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] text-ink">{result.scenario.label}</span>
                {result.binding ? (
                  <span className="shrink-0 text-xs text-brand">Binding</span>
                ) : null}
              </span>
              <span className="text-xs leading-snug text-off">{result.scenario.narrative}</span>
            </div>
            <FigureGrid>
              <Figure
                label="Impact"
                value={formatSignedCompactUsd(result.impact)}
                valueTone={tone(result.impact)}
              />
              <Figure label="Headroom" value={formatCompactUsd(result.headroom)} />
              <Figure label="Health" value={formatMultiple(result.healthFactor)} />
            </FigureGrid>
          </StackRow>
        ))}
      </ul>
    </Panel>
  );
}

export function ExpiryLadderPanel({ rungs }: { rungs: LadderRung[] }) {
  return (
    <Panel title="Expiry and cash ladder" note="Collateral released at each fixing">
      <div className={WIDE}>
        <table className={`${TABLE} min-w-[720px] table-fixed`}>
          <caption className="sr-only">
            Maturing packages by expiry, with collateral released, terminal residual cash, and the
            available collateral that results once each rung settles.
          </caption>
          <thead className="bg-panel">
            <tr className="border-b border-line">
              <th scope="col" className={`${TH} w-[108px]`}>
                Expiry
              </th>
              <th scope="col" className={TH}>
                Maturing packages
              </th>
              <th scope="col" className={`${TH} w-[60px] text-right`}>
                Lots
              </th>
              <th scope="col" className={`${TH} w-[132px] text-right`}>
                Collateral release
              </th>
              <th scope="col" className={`${TH} w-[116px] text-right`}>
                Residual cash
              </th>
              <th scope="col" className={`${TH} w-[126px] text-right`}>
                Available after
              </th>
              <th scope="col" className={`${TH} w-[112px]`}>
                State
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rungs.map((rung) => (
              <tr key={rung.expiryIso}>
                <th scope="row" className={`${TD} h-10 text-left font-normal`}>
                  <span className="flex flex-col">
                    <span className="tnum font-mono text-xs text-ink">
                      {formatExpiry(rung.expiryIso)}
                    </span>
                    <span className="tnum font-mono text-xs text-off">{`${rung.days}d`}</span>
                  </span>
                </th>
                <td className={`${TD} text-dim`}>
                  <span className="block truncate">
                    {rung.positions.map((position) => position.label).join(", ")}
                  </span>
                </td>
                <td className={`${NUM} text-dim`}>{rung.lots}</td>
                <td className={`${NUM} text-ink`}>{formatUsd(rung.collateralRelease, 0)}</td>
                <td className={`${NUM} ${tone(rung.residualCash)}`}>
                  {formatSignedUsd(rung.residualCash, 0)}
                </td>
                <td className={`${NUM} text-dim`}>{formatUsd(rung.availableAfter, 0)}</td>
                <td className={TD}>
                  <StateTag state={rung.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className={NARROW}>
        {rungs.map((rung) => (
          <StackRow key={rung.expiryIso}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="tnum shrink-0 font-mono text-[13px] text-ink">
                {`${formatExpiry(rung.expiryIso)} / ${rung.days}d`}
              </span>
              <StateTag state={rung.state} />
            </div>
            <p className="text-xs leading-snug text-dim">
              {rung.positions.map((position) => position.label).join(", ")}
            </p>
            <FigureGrid>
              <Figure label="Lots" value={rung.lots} />
              <Figure label="Release" value={formatCompactUsd(rung.collateralRelease)} />
              <Figure
                label="Residual"
                value={formatSignedCompactUsd(rung.residualCash)}
                valueTone={tone(rung.residualCash)}
              />
            </FigureGrid>
            <Figure label="Available after" value={formatUsd(rung.availableAfter, 0)} />
          </StackRow>
        ))}
      </ul>
    </Panel>
  );
}

export function CollateralPanel({
  lines,
  eligible,
  reserved,
  available,
  className,
}: {
  lines: CollateralLine[];
  eligible: number;
  reserved: number;
  available: number;
  className?: string;
}) {
  return (
    <Panel
      title="Collateral inventory"
      note="Haircut applied before it counts as margin"
      className={className}
    >
      <div className={WIDE}>
        <table className={`${TABLE} min-w-[720px] table-fixed`}>
          <caption className="sr-only">
            Posted collateral by asset, with the haircut applied before it counts as margin, the
            amount already reserved against positions, and how each line can be withdrawn.
          </caption>
          <thead className="bg-panel">
            <tr className="border-b border-line">
              <th scope="col" className={`${TH} w-[190px]`}>
                Asset
              </th>
              <th scope="col" className={`${TH} w-[112px] text-right`}>
                Posted
              </th>
              <th scope="col" className={`${TH} w-[72px] text-right`}>
                Haircut
              </th>
              <th scope="col" className={`${TH} w-[112px] text-right`}>
                Eligible
              </th>
              <th scope="col" className={`${TH} w-[112px] text-right`}>
                Reserved
              </th>
              <th scope="col" className={`${TH} w-[112px] text-right`}>
                Available
              </th>
              <th scope="col" className={TH}>
                Withdrawal
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {lines.map((line) => (
              <tr key={line.asset.id}>
                <th scope="row" className={`${TD} h-10 text-left font-normal`}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs text-ink">{line.asset.asset}</span>
                    <span className="truncate text-xs text-off">{line.asset.source}</span>
                  </span>
                </th>
                <td className={`${NUM} text-dim`}>{formatUsd(line.asset.value, 0)}</td>
                <td className={`${NUM} text-dim`}>{formatShare(line.asset.haircut, 0)}</td>
                <td className={`${NUM} text-ink`}>{formatUsd(line.eligible, 0)}</td>
                <td className={`${NUM} text-dim`}>{formatUsd(line.asset.reserved, 0)}</td>
                <td className={`${NUM} text-dim`}>{formatUsd(line.available, 0)}</td>
                <td className={TD} title={line.asset.withdrawalNote}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-dim">
                      {WITHDRAWAL_LABEL[line.asset.withdrawal]}
                    </span>
                    <span className="truncate text-off">{line.asset.withdrawalNote}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-inset">
              <th scope="row" className={`${TD} h-9 text-left font-normal text-dim`}>
                Total
              </th>
              <td className={`${NUM} text-off`} />
              <td className={`${NUM} text-off`} />
              <td className={`${NUM} text-ink`}>{formatUsd(eligible, 0)}</td>
              <td className={`${NUM} text-dim`}>{formatUsd(reserved, 0)}</td>
              <td className={`${NUM} text-dim`}>{formatUsd(available, 0)}</td>
              <td className={`${TD} text-off`} />
            </tr>
          </tfoot>
        </table>
      </div>

      <ul className={NARROW}>
        {lines.map((line) => (
          <StackRow key={line.asset.id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-ink">{line.asset.asset}</span>
                <span className="block truncate text-xs text-off">{line.asset.source}</span>
              </span>
              <span className="shrink-0 text-xs text-dim">
                {WITHDRAWAL_LABEL[line.asset.withdrawal]}
              </span>
            </div>
            <FigureGrid cols={2}>
              <Figure label="Posted" value={formatUsd(line.asset.value, 0)} />
              <Figure label="Haircut" value={formatShare(line.asset.haircut, 0)} />
              <Figure label="Eligible" value={formatUsd(line.eligible, 0)} valueTone="text-ink" />
              <Figure label="Reserved" value={formatUsd(line.asset.reserved, 0)} />
              <Figure label="Available" value={formatUsd(line.available, 0)} />
            </FigureGrid>
            <p className="text-xs leading-snug text-off">{line.asset.withdrawalNote}</p>
          </StackRow>
        ))}
      </ul>
    </Panel>
  );
}
