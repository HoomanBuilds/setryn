import { redirect } from "next/navigation";

/** Receipts are listed in activity; this path only exists as the parent of `/receipts/[id]`. */
export default function ReceiptsIndex() {
  redirect("/activity");
}
