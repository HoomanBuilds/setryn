import { GET as deploymentEvidence } from "@/app/api/internal/deployment/route";
import { PublicApiError } from "@/lib/public-api/errors";
import { publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EvidenceBody {
  environment?: string;
  status?: string;
  sourceCommit?: string | null;
  contracts?: { state: string }[];
  error?: string;
}

/** Chain identity, head, and a summary of the same code-hash evidence check the platform's /status page runs. */
export const GET = publicRoute({ scope: "read" }, async () => {
  const [context, evidenceResponse] = await Promise.all([chainContext(), deploymentEvidence()]);
  const evidence = (await evidenceResponse.json()) as EvidenceBody;
  if (!evidenceResponse.ok || !evidence.contracts) {
    throw new PublicApiError(503, "CHAIN_UNAVAILABLE", "Deployment evidence is unavailable.");
  }
  const head = await context.client.getBlock({ blockNumber: context.headBlock });
  const matching = evidence.contracts.filter((contract) => contract.state === "MATCHES").length;
  const { setryn } = context;
  return {
    data: {
      environment: evidence.environment ?? "LOCAL_DEVNET",
      chainId: setryn.chainId,
      headBlock: context.headBlock.toString(),
      headTime: new Date(Number(head.timestamp) * 1000).toISOString(),
      chainTime: new Date(Number(context.chainTime) * 1000).toISOString(),
      deployment: {
        status: evidence.status ?? "UNKNOWN",
        sourceCommit: evidence.sourceCommit ?? null,
        contracts: evidence.contracts.length,
        matching,
        state: matching === evidence.contracts.length && matching > 0 ? "VERIFIED" : "DEGRADED",
      },
      settlement: { token: setryn.settlementToken, assetId: setryn.settlementAssetId, collateralSymbol: "sUSD", decimals: 6 },
      contracts: {
        collateralVault: setryn.collateralVault,
        orderState: setryn.orderState,
        riskAdmissionBindingRegistry: setryn.riskAdmissionBindingRegistry,
        portfolioRiskEngine: setryn.portfolioRiskEngine,
        atomicClearingEngine: setryn.atomicClearingEngine,
        publicOrderBook: setryn.publicOrderBook,
        positionEngine: setryn.positionEngine,
        fundedFeeEngine: setryn.fundedFeeEngine,
        settlementToken: setryn.settlementToken,
      },
    },
  };
});
