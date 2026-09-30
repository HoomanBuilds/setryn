import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RfqCompetition } from "@/components/rfqs/RfqCompetition";
import { SAMPLE_REQUEST_ID } from "@/components/rfqs/rfq-sample";

type RfqPageProps = { params: Promise<{ id: string }> };

/** RFQ ids are onchain request hashes; the walkthrough uses a reserved word. Anything else is malformed. */
const REQUEST_ID = /^0x[0-9a-fA-F]{64}$/;

export async function generateMetadata({ params }: RfqPageProps): Promise<Metadata> {
  const { id } = await params;
  if (id === SAMPLE_REQUEST_ID) {
    return { title: "RFQ walkthrough / Setryn", description: "Modeled multi-maker quote competition built from the preview feed." };
  }
  return {
    title: REQUEST_ID.test(id) ? `RFQ ${id.slice(0, 10)} / Setryn` : "RFQ not found / Setryn",
    description: "Private RFQ quote competition, winning rule, and clearing timeline.",
  };
}

export default async function RfqPage({ params }: RfqPageProps) {
  const { id } = await params;
  if (id !== SAMPLE_REQUEST_ID && !REQUEST_ID.test(id)) notFound();
  return <RfqCompetition requestId={id} />;
}
