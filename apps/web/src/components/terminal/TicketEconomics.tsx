"use client";

import { AssetAmount } from "@/components/icons/AssetIcon";
import { DataRow, Disclosure } from "@/components/terminal/primitives";
import { RECOVERY_COPY, type EconomicsPreview } from "@/lib/terminal/economics";
import {
  formatBps,
  formatLots,
  formatNumber,
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
          value={
            isExit ? (
              "No new collateral"
            ) : sized ? (
              <AssetAmount value={formatNumber(preview.totalCollateral, 2)} symbol="USDC" />
            ) : (
              dash
            )
          }
          title={
            isExit
              ? "Exits require no new collateral. Pro-rata collateral is released and the fee cap is paid from released plus available funds."
              : "Collateral locked at the fill: the bounded liability of the range, at most lots x lot size x (cap - floor)."
          }
        />
        <DataRow
          dense
          label="All-in fee"
          value={
            sized && route ? (
              <span className="inline-flex items-baseline gap-1">
                <span className="text-faint">{`(${formatBps(feeBps)})`}</span>
                <AssetAmount value={formatNumber(preview.totalFees, 2)} symbol="USDC" />
              </span>
            ) : (
              dash
            )
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
            label={market.feeOnConsideration ? "Consideration" : "Notional"}
            value={sized ? formatUsd(preview.notional, 2) : dash}
            title={market.feeOnConsideration ? "Lots x (price - floor) x lot size: what the long pays at the fill and what fees are charged on." : undefined}
          />
          <DataRow
          dense
            label="Effective price"
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
          {`The mark and route prices come from the onchain book (${preview.freshnessLabel.toLowerCase()}). Collateral is the bounded liability of the range; fees are the active schedule's rate on consideration, estimated before authorization.`}
        </p>
      </Disclosure>
    </div>
  );
}
