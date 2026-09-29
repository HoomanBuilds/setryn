import Link from "next/link";
import { DEFAULT_TRADE_HREF } from "@/lib/terminal/markets";

export default function NotFound() {
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4 py-10 text-center">
      <div className="max-w-[420px]">
        <p className="text-xs font-medium tracking-[0.08em] text-faint uppercase">404</p>
        <h1 className="mt-1.5 text-base font-semibold text-ink">That market is not listed</h1>
        <p className="mt-1.5 text-sm leading-snug text-dim">
          The URL does not match any package market in this build. Open the directory to see every
          listed market, or go to the default terminal.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/markets"
          className="focus-ring flex h-11 items-center rounded-md border border-line-strong bg-raised px-3.5 text-sm text-ink transition-colors hover:border-brand-edge lg:h-9"
        >
          Browse markets
        </Link>
        <Link
          href={DEFAULT_TRADE_HREF}
          className="focus-ring flex h-11 items-center rounded-md border border-line bg-panel px-3.5 text-sm text-dim transition-colors hover:text-ink lg:h-9"
        >
          Open default terminal
        </Link>
      </div>
    </main>
  );
}
