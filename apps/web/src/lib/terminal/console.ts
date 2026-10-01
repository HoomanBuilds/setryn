import type { ConsoleTabId } from "./types";

export const CONSOLE_TABS: { id: ConsoleTabId; label: string }[] = [
  { id: "strategies", label: "Strategies" },
  { id: "orders", label: "Orders" },
  { id: "rfqs", label: "RFQs" },
  { id: "fills", label: "Fills" },
  { id: "recovery", label: "Recovery" },
  { id: "receipts", label: "Receipts" },
];
