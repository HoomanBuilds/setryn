# Setryn Web

The Next.js application for the public Setryn landing experience and the Setryn exchange, portfolio, lifecycle, maker, and evidence surfaces.

## Structure

The app uses two root layouts so the landing's global styles, fonts, smooth scrolling, and sound never reach the terminal. Moving between them is a full document navigation.

- `src/app/(landing)/`: the public landing at `/`, with the candidate heroes at `/b` and `/c`. Components live in `src/components/landing/`, helpers in `src/lib/landing/`, fonts in `src/app/(landing)/fonts/`, and artwork and audio in `public/`.
- `src/app/(platform)/`: the trading platform and operator routes with the terminal shell and shared providers. `/trade` resolves to the default market.
- `src/app/api/`: internal route handlers.
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

Protocol interaction will be introduced through shared Setryn packages. Pages must not maintain private ABI fragments or invent contract behavior.
