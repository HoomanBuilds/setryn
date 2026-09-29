import { redirect } from "next/navigation";
import { DEFAULT_TRADE_HREF } from "@/lib/terminal/markets";

/** The application entry: `/trade` resolves to the default market terminal. */
export default function TradeIndexPage() {
  redirect(DEFAULT_TRADE_HREF);
}
