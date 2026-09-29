"use client";

import { DataRow, Disclosure } from "@/components/terminal/primitives";
import { RECOVERY_COPY, type EconomicsPreview } from "@/lib/terminal/economics";
import {
  formatBps,
  formatLots,
  formatNumber,
  formatSignedUsd,
  formatUsd,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import type { PackageMarket, RouteQuote } from "@/lib/terminal/types";

export function TicketEconomics({
  market,
  preview,
  route,
  intent,
}: {
  market: PackageMarket;
  preview: EconomicsPreview;
  route: RouteQuote | null;
  intent: "ENTER" | "EXIT";
}) {
  const sized = preview.fillLots > 0;
  const unit = priceUnitSuffix(market.priceUnit);
  const feeBps = route ? route.protocolFeeBps + route.counterpartyFeeBps : 0;
  const recovery = route ? RECOVERY_COPY[route.guarantee] : null;
  const dash = "not set";
  const isExit = intent === "EXIT";
  const partial = preview.cancelledLots > 1e-9;

  return (
    <div className="border-t border-line pt-2">
      <div>
        {partial ? (
          <>
            <DataRow
          dense
              label="Requested"
              value={`${formatLots(preview.requestedLots)} lots`}
            />
            <DataRow
          dense
              label="Expected fill"
              value={`${formatLots(preview.fillLots)} lots`}
            />
            <DataRow
          dense
              label="IOC remainder"
              value={`${formatLots(preview.cancelledLots)} lots cancelled`}
            />
          </>
        ) : null}
        <DataRow
          dense
          label={isExit ? "New collateral" : "Collateral required"}
          value={isExit ? "No new collateral" : sized ? formatUsd(preview.totalCollateral, 2) : dash}
          title={
            isExit
              ? "Exits require no new collateral. Pro-rata collateral is released and the fee cap is paid from released plus available funds."
              : "Scenario margin for this package under the selected route."
          }
        />
        <DataRow
          dense
          label="All-in fee"
          value={
            sized && route
              ? `${formatUsd(preview.totalFees, 2)} (${formatBps(feeBps)})`
              : dash
          }
        />
        <DataRow
          dense
          label="Max exposure while filling"
          value={
            !route
              ? dash
              : preview.maxIntermediateExposure > 0
                ? formatUsd(preview.maxIntermediateExposure, 2)
                : "None, legs are atomic"
          }
          tone={preview.maxIntermediateExposure > 0 ? "down" : "default"}
          title="Unhedged package value between the first and the last leg confirmation."
        />
        <DataRow
          dense
          label="Settlement guarantee"
          value={preview.settlementGuarantee}
          tone="muted"
          title={preview.guaranteeDetail}
        />
      </div>

      <Disclosure summary="Advanced details">
        <div>
          <DataRow
          dense
            label="Package notional"
            value={sized ? formatUsd(preview.notional, 0) : dash}
          />
          <DataRow
          dense
            label="Effective package price"
            value={
              sized
                ? `${formatNumber(preview.effectivePrice, market.priceDecimals)} ${unit}`
                : dash
            }
          />
          <DataRow
          dense
            label="Protocol fee"
            value={sized ? formatUsd(preview.protocolFee, 2) : dash}
          />
          <DataRow
          dense
            label={preview.counterpartyFeeLabel}
            value={sized ? formatUsd(preview.counterpartyFee, 2) : dash}
          />
          <DataRow
          dense
            label="Terminal residual at fixing"
            value={sized ? formatSignedUsd(preview.terminalResidual, 2) : dash}
            tone={preview.terminalResidual >= 0 ? "up" : "down"}
          />
        </div>

        <p className="mt-3 text-xs leading-relaxed text-faint">{preview.guaranteeDetail}</p>

        {recovery ? (
          <div className="mt-3">
            <p className="text-xs text-dim">Recovery boundary</p>
            <div className="mt-1 divide-y divide-line border-t border-line">
              <DataRow dense label="Reconcile window" value={recovery.reconcileWindow} tone="muted" />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-faint">{recovery.unknownPath}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-faint">{recovery.fallback}</p>
          </div>
        ) : null}

        <p className="mt-3 text-xs leading-relaxed text-off">
          {`Package mark comes from the active market feed. Route price is executable against ${preview.freshnessLabel.toLowerCase()}. Collateral and fees are estimated before authorization. Residual and exposure remain modeled.`}
        </p>
      </Disclosure>
    </div>
  );
}
