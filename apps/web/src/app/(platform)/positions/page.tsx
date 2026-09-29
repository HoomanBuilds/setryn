import { redirect } from "next/navigation";

/** Positions are listed in the portfolio; this path only exists as the parent of `/positions/[id]`. */
export default function PositionsIndex() {
  redirect("/portfolio/positions");
}
