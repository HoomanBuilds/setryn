# Setryn Web

The Next.js application for the public Setryn landing experience and the Setryn exchange, portfolio, lifecycle, maker, and evidence surfaces.

## Structure

The app uses two root layouts so the landing's global styles, fonts, smooth scrolling, and sound never reach the terminal. Moving between them is a full document navigation.

- `src/app/(landing)/`: the public landing at `/`. Components live in `src/components/landing/`, helpers in `src/lib/landing/`, fonts in `src/app/(landing)/fonts/`, and artwork and audio in `public/`.
- `src/app/(platform)/`: the trading platform and operator routes with the terminal shell and shared providers. `/trade` resolves to the default market. Main routes: `/trade/[market]`, `/markets`, `/portfolio`, `/positions/[id]`, `/settlements`, `/rfqs`, `/auctions`, `/activity`, `/maker`, `/solver`, `/operations`, `/treasury`, `/status`, `/developers` and `/partners`.
- `src/app/(embed)/`: framable partner widgets under `/embed/*`.
- `src/app/api/v1/`: the versioned public API (OpenAPI at `/api/v1/openapi.json`).
- `src/app/api/internal/`: internal route handlers; `devnet/*` routes run only against the local chain (31337) from loopback.
- `src/app/global-not-found.tsx`: unmatched URLs render the terminal 404 inside the platform shell.

The landing enters the platform through `src/lib/landing/app-links.ts`.

## Commands

Run from the repository root:

```bash
pnpm dev
pnpm --filter @setryn/web lint
pnpm --filter @setryn/web typecheck
pnpm --filter @setryn/web build
```

## Wallets

Wallet connection uses wagmi, viem, TanStack Query and RainbowKit (`src/components/wallet/`, `src/lib/wallet/config.ts`),
mounted only in the platform layout. `WalletBridge` hands the connected wallet's provider to the gateway, which signs and
sends every transaction. Browser wallets (EIP-6963), Coinbase Wallet and Safe are always offered; WalletConnect appears
when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set (see `.env.example`).

## Local chain

The platform reads `deployments/local/runtime.json` (schema 9), written by `scripts/local-deploy-reset.sh`. Fee rates,
fee, market and series versions are read from the contracts at runtime (`src/lib/internal-gateway/fee-schedule.ts`), so
a fee change made with `scripts/update-devnet-fees.mjs` or the Treasury page applies without a restart.

Pages must not invent contract behavior: every executable value is read from the deployed contracts or the runtime.
