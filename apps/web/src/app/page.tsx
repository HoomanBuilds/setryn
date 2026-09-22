import { redirect } from "next/navigation";
import { DEFAULT_TRADE_HREF } from "@/lib/terminal/markets";

/** The product has no landing page: the root resolves to the default terminal. */
export default function RootPage() {
  redirect(DEFAULT_TRADE_HREF);
}
