# Setryn Web

The Next.js application for the Setryn exchange, portfolio, lifecycle, maker, and evidence surfaces.

## Commands

Run from the repository root:

```bash
pnpm dev
pnpm --filter @setryn/web lint
pnpm --filter @setryn/web typecheck
pnpm --filter @setryn/web build
```

Protocol interaction will be introduced through shared Setryn packages. Pages must not maintain private ABI fragments or invent contract behavior.
