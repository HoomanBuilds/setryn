import Link from "next/link";

export default function RfqNotFound() {
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 bg-app px-4 py-10 text-center">
      <div className="max-w-[440px]">
        <p className="text-xs font-medium tracking-[0.08em] text-faint uppercase">404</p>
        <h1 className="mt-1.5 font-serif text-[22px] leading-7 text-ink">That RFQ reference is not valid</h1>
        <p className="mt-1.5 text-sm leading-snug text-dim">
          Private requests are addressed by their onchain request hash. This link does not contain one, so there is nothing
          to load.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/rfqs"
          className="focus-ring flex h-11 items-center rounded-md border border-line-strong bg-raised px-3.5 text-sm text-ink transition-colors hover:border-brand-edge lg:h-9"
        >
          RFQ ledger
        </Link>
        <Link
          href="/rfqs/new"
          className="focus-ring flex h-11 items-center rounded-md border border-line bg-panel px-3.5 text-sm text-dim transition-colors hover:text-ink lg:h-9"
        >
          New RFQ
        </Link>
      </div>
    </main>
  );
}
