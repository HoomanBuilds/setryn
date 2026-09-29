import { redirect } from "next/navigation";
import { aliasHref, type SearchParamsRecord } from "@/lib/settings/aliases";

/** Spec route for the exposure and outcome builder. The builder lives at `/hedges`; the query carries any prefill. */
export default async function ProtectNewPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  redirect(aliasHref("/hedges", await searchParams));
}
