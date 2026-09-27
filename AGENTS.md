# Setryn Project Workflow

- The primary agent owns architecture, task decomposition, reviews, and handoffs.
- Use OpenCode with Muse 1.3 at xhigh for implementation. Do not use Claude CLI or Codex sub-agents for implementation.
- Parallelize independent slices and keep file ownership separate to avoid conflicts.
- Prioritize product progression over exhaustive testing.
- Accumulate bounded implementation slices within the active phase. Review and run the phase verification gate only after the phase deliverables are complete.
- Keep phase-gate reviews targeted to the surfaces changed during that phase. Do not repeat broad checks after individual slices or perform broad audits unless explicitly requested.
- Even when tests and review are deferred, do not call a contract phase implementation-complete until the production Solidity sources compile with the pinned deployment profile.
- Never spend funds or write to mainnet during development. Use testnet, devnet, fixtures, or read-only mainnet research.
- Preview market movement must come from one coherent feed so marks, quotes, books, routes, and charts do not contradict each other.
- Build the complete user trading platform before public developer products. Internal schemas, generated bindings, indexing, and application data services may be built when the platform consumes them, but public APIs, external SDKs, webhooks, widgets, and partner tooling belong after the core user product.
- Treat code under `inspiration/` as reference material, never as a runtime dependency or source of truth.
- Do not qualify or activate an economic object from opaque commitments alone. Registration and activation must validate the same bounded canonical data against exact versioned dependencies and publish enough event data for deterministic reconstruction.
- Revoking authority may stop new risk, but it must not deadlock historical positions or collateral. Terminal resolution must follow objective committed state with a permissionless completion path.
- Indexer payloads must canonicalize contract enums explicitly and cover every state-changing event. Never let decoder-specific values silently shape projected accounting.
