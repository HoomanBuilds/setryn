import { redirect } from "next/navigation";
import { aliasHref, type SearchParamsRecord } from "@/lib/settings/aliases";

/** `Protect` in the global navigation opens the outcome-first hedge builder. */
export default async function ProtectPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  redirect(aliasHref("/hedges", await searchParams));
}
