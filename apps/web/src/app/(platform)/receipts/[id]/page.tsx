import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReceiptExplorer } from "@/components/gateway/ReceiptExplorer";
import { isRouteSafeId } from "@/lib/positions/dossier";

type ReceiptPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: ReceiptPageProps): Promise<Metadata> {
  const { id } = await params;
  const short = id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
  return {
    title: isRouteSafeId(id) ? `Receipt ${short} / Setryn` : "Receipt not found / Setryn",
    description: "Verifiable execution and settlement evidence: signed order, fill, transaction reference and receipt.",
  };
}

/**
 * Canonical receipt route from the route map. It renders the same evidence
 * view as `/activity/receipts/[receiptId]`, so both links resolve to one page.
 */
export default async function ReceiptPage({ params }: ReceiptPageProps) {
  const { id } = await params;
  if (!isRouteSafeId(id)) notFound();
  return <ReceiptExplorer receiptId={id} />;
}
