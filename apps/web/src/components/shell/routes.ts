import { DEFAULT_TRADE_HREF } from "@/lib/terminal/markets";

export interface NavItem {
  id: string;
  label: string;
  /** Path prefix that marks the item active. */
  prefix: string;
  href: string;
  description: string;
  /** Extra words the command search matches. */
  keywords?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/** One registry for the header, the mobile menu, and command search, following the interface spec route map. */
export const HOME_ITEM: NavItem = {
  id: "home",
  label: "Home",
  prefix: "/app",
  href: "/app",
  description: "Account summary, pending actions, and system health",
  keywords: "dashboard overview account",
};

export const PRIMARY_NAV: NavItem[] = [
  {
    id: "trade",
    label: "Trade",
    prefix: "/trade",
    href: DEFAULT_TRADE_HREF,
    description: "Package market terminal with book, chart, and ticket",
    keywords: "terminal order buy sell chart",
  },
  {
    id: "markets",
    label: "Markets",
    prefix: "/markets",
    href: "/markets",
    description: "Every listed package market, ladder, and curve",
    keywords: "discovery table curve expiry",
  },
  {
    id: "portfolio",
    label: "Portfolio",
    prefix: "/portfolio",
    href: "/portfolio",
    description: "Positions, collateral, risk, and PnL",
    keywords: "positions collateral risk pnl balances",
  },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "build",
    label: "Build",
    items: [
      {
        id: "strategies",
        label: "Strategy studio",
        prefix: "/strategies",
        href: "/strategies",
        description: "Multi-leg packages, payoff, and templates",
        keywords: "builder legs payoff package",
      },
      {
        id: "protect",
        label: "Protect",
        prefix: "/hedges",
        href: "/hedges",
        description: "Hedge a dated cash flow in outcome terms",
        keywords: "hedge builder exposure protect",
      },
      {
        id: "exposures",
        label: "Exposures",
        prefix: "/exposures",
        href: "/exposures",
        description: "Imported, forecast, netted, and protected exposures",
        keywords: "cash flow forecast coverage",
      },
    ],
  },
  {
    id: "execute",
    label: "Execute",
    items: [
      {
        id: "rfqs",
        label: "RFQs",
        prefix: "/rfqs",
        href: "/rfqs",
        description: "Private multi-maker quote competition",
        keywords: "request for quote private makers",
      },
      {
        id: "rfq-new",
        label: "New RFQ",
        prefix: "/rfqs/new",
        href: "/rfqs/new",
        description: "Request firm quotes for a package",
        keywords: "request quote builder",
      },
      {
        id: "auctions",
        label: "Auctions",
        prefix: "/auctions",
        href: "/auctions",
        description: "Sealed and batch auction board",
        keywords: "sealed batch clearing round",
      },
    ],
  },
  {
    id: "monitor",
    label: "Monitor",
    items: [
      {
        id: "activity",
        label: "Activity",
        prefix: "/activity",
        href: "/activity",
        description: "Orders, fills, and receipt evidence",
        keywords: "fills orders history receipts ledger",
      },
      {
        id: "lifecycle",
        label: "Lifecycle",
        prefix: "/lifecycle",
        href: "/lifecycle",
        description: "Fixing, expiry, roll, and exit calendar",
        keywords: "roll expiry fixing calendar",
      },
      {
        id: "settlements",
        label: "Settlements",
        prefix: "/settlements",
        href: "/settlements",
        description: "Observations, payouts, and reconciliation",
        keywords: "payout fixing reconciliation",
      },
      {
        id: "alerts",
        label: "Alerts",
        prefix: "/alerts",
        href: "/alerts",
        description: "Market, risk, fixing, and system alerts",
        keywords: "notifications rules",
      },
    ],
  },
  {
    id: "operate",
    label: "Operate",
    items: [
      {
        id: "maker",
        label: "Maker desk",
        prefix: "/maker",
        href: "/maker",
        description: "Quote surfaces, inventory, and risk limits",
        keywords: "market maker quotes inventory",
      },
      {
        id: "solver",
        label: "Solver",
        prefix: "/solver",
        href: "/solver",
        description: "Opportunities, routes, and reserved capacity",
        keywords: "routing capacity solver",
      },
      {
        id: "operations",
        label: "Operations",
        prefix: "/operations",
        href: "/operations",
        description: "Dependencies, queues, recovery, and policy",
        keywords: "ops health incidents kill switch",
      },
      {
        id: "settings",
        label: "Settings",
        prefix: "/settings",
        href: "/settings",
        description: "Organizations, roles, approvals, and privacy",
        keywords: "preferences account security",
      },
    ],
  },
];

export const ALL_ROUTES: NavItem[] = [HOME_ITEM, ...PRIMARY_NAV, ...NAV_GROUPS.flatMap((group) => group.items)];

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.id === "rfqs") {
    // The builder has its own entry; the ledger covers every other RFQ path.
    return (pathname === "/rfqs" || pathname.startsWith("/rfqs/")) && !pathname.startsWith("/rfqs/new");
  }
  return pathname === item.prefix || pathname.startsWith(`${item.prefix}/`);
}

export function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.items.some((item) => isActive(item, pathname));
}

/** Trade keeps the market already on screen, so the tab never jumps markets. */
export function hrefFor(item: NavItem, pathname: string): string {
  if (item.id === "trade" && isActive(item, pathname)) return pathname;
  return item.href;
}
