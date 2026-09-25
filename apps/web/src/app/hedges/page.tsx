import { redirect } from "next/navigation";

/** Hedge construction is the graph mode of the Strategy Studio, not a separate product. */
export default function HedgesPage() {
  redirect("/strategies");
}
