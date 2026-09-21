export default function Home() {
  return (
    <main className="min-h-screen bg-[#080b0f] px-6 py-8 text-[#e7edf5] sm:px-10 lg:px-14">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col border border-[#202833] bg-[#0c1117]">
        <header className="flex items-center justify-between border-b border-[#202833] px-5 py-4 sm:px-7">
          <div>
            <p className="text-sm font-semibold tracking-[0.22em] text-[#8ea0b5]">SETRYN</p>
            <p className="mt-1 text-xs text-[#607086]">Protocol workspace</p>
          </div>
          <span className="border border-[#263243] px-3 py-1.5 text-xs text-[#9dafc4]">Arbitrum Sepolia</span>
        </header>

        <section className="grid flex-1 gap-10 px-5 py-12 sm:px-7 lg:grid-cols-[1.35fr_0.65fr] lg:items-end lg:px-12 lg:py-16">
          <div className="max-w-3xl">
            <p className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-[#7790aa]">Core-first build initialized</p>
            <h1 className="text-balance text-4xl font-medium tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
              Package-native markets on Arbitrum.
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-[#8fa0b4] sm:text-lg">
              Setryn is building complete onchain markets for structured positions, with execution, collateral, risk,
              settlement, lifecycle, and evidence designed as one protocol.
            </p>
          </div>

          <dl className="divide-y divide-[#202833] border-y border-[#202833] font-mono text-xs">
            <div className="flex items-center justify-between py-4">
              <dt className="text-[#63758b]">Contracts</dt>
              <dd className="text-[#9fefc5]">Foundry ready</dd>
            </div>
            <div className="flex items-center justify-between py-4">
              <dt className="text-[#63758b]">Application</dt>
              <dd className="text-[#c1ccda]">Next.js ready</dd>
            </div>
            <div className="flex items-center justify-between py-4">
              <dt className="text-[#63758b]">Writes</dt>
              <dd className="text-[#c1ccda]">Testnet only</dd>
            </div>
          </dl>
        </section>
      </div>
    </main>
  );
}
