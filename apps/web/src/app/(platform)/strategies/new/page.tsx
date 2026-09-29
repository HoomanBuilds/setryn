import { redirect } from "next/navigation";
import { aliasHref, type SearchParamsRecord } from "@/lib/settings/aliases";

/** Spec route for the multi-leg strategy studio, which is built at `/strategies`. */
export default async function StrategiesNewPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  redirect(aliasHref("/strategies", await searchParams));
}
