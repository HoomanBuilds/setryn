import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PositionSkeleton } from "@/components/positions/PositionGate";
import { PositionWorkspace } from "@/components/positions/PositionWorkspace";
import { LIFECYCLE_STRATEGIES } from "@/lib/lifecycle/fixtures";
import { isRouteSafeId } from "@/lib/positions/dossier";

type PositionPageProps = { params: Promise<{ id: string }> };

function label(id: string): string {
  const reference = LIFECYCLE_STRATEGIES.find((strategy) => strategy.id === id);
  if (reference) return reference.label;
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export async function generateMetadata({ params }: PositionPageProps): Promise<Metadata> {
  const { id } = await params;
  if (!isRouteSafeId(id)) return { title: "Position not found / Setryn" };
  return {
    title: `Position ${label(id)} / Setryn`,
    description: "Position lifecycle: marks, collateral and health, fixings and settlement, linked fills and receipts.",
  };
}

export default async function PositionPage({ params }: PositionPageProps) {
  const { id } = await params;
  /* Anything outside the identifier alphabet cannot name a position, so it is a real 404. Whether a
     well-formed id is held is only known from the connected account, which the client resolves. */
  if (!isRouteSafeId(id)) notFound();
  return (
    <Suspense fallback={<PositionSkeleton />}>
      <PositionWorkspace positionId={id} />
    </Suspense>
  );
}
