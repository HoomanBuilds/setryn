import { redirect } from "next/navigation";
import { aliasHref, type SearchParamsRecord } from "@/lib/settings/aliases";

/** Spec route for the risk and operations console, which is built at `/operations`. */
export default async function OpsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  redirect(aliasHref("/operations", await searchParams));
}
