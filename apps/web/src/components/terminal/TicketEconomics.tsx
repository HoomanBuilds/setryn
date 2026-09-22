"use client";

import { DataRow, Disclosure } from "@/components/terminal/primitives";
import { RECOVERY_COPY, type EconomicsPreview } from "@/lib/terminal/economics";
import {
  formatBps,
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
}: {
  market: PackageMarket;
  preview: EconomicsPreview;
  route: RouteQuote | null;
}) {
  const sized = preview.lots > 0;
  const unit = priceUnitSuffix(market.priceUnit);
  const feeBps = route ? route.protocolFeeBps + route.counterpartyFeeBps : 0;
  const recovery = route ? RECOVERY_COPY[route.guarantee] : null;
  const dash = "not set";

  return (
    <div className="border-t border-line pt-1">
      <div className="divide-y divide-line">
        <DataRow
          label="Collateral required"
          value={sized ? formatUsd(preview.totalCollateral, 2) : dash}
          title="Scenario margin for this package under the selected route."
        />
        <DataRow
          label="All-in fee"
          value={
            sized && route
              ? `${formatUsd(preview.totalFees, 2)} (${formatBps(feeBps)})`
              : dash
          }
        />
        <DataRow
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
          label="Settlement guarantee"
          value={preview.settlementGuarantee}
          tone="muted"
          title={preview.guaranteeDetail}
        />
      </div>

      <Disclosure summary="Advanced details">
        <div className="divide-y divide-line">
          <DataRow
            label="Package notional"
            value={sized ? formatUsd(preview.notional, 0) : dash}
          />
          <DataRow
            label="Effective package price"
            value={
              sized
                ? `${formatNumber(preview.effectivePrice, market.priceDecimals)} ${unit}`
                : dash
            }
          />
          <DataRow
            label="Protocol fee"
            value={sized ? formatUsd(preview.protocolFee, 2) : dash}
          />
          <DataRow
            label={preview.counterpartyFeeLabel}
            value={sized ? formatUsd(preview.counterpartyFee, 2) : dash}
          />
          <DataRow
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
              <DataRow label="Reconcile window" value={recovery.reconcileWindow} tone="muted" />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-faint">{recovery.unknownPath}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-faint">{recovery.fallback}</p>
          </div>
        ) : null}

        <p className="mt-3 text-xs leading-relaxed text-off">
          {`Package mark is observed from the preview fixture. Route price is executable against ${preview.freshnessLabel.toLowerCase()}. Collateral and fees are estimated from those inputs. Residual and exposure are modeled.`}
        </p>
      </Disclosure>
    </div>
  );
}
