import type { Metadata } from "next";
import { ReceiptExplorer } from "@/components/gateway/ReceiptExplorer";

type ReceiptPageProps = { params: Promise<{ receiptId: string }> };

export const metadata: Metadata = {
  title: "Execution receipt / Setryn",
  description: "Development-chain package execution receipt and evidence fields.",
};

export default async function ReceiptPage({ params }: ReceiptPageProps) {
  const { receiptId } = await params;
  return <ReceiptExplorer receiptId={receiptId} />;
}
