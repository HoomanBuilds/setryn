# Setryn Contracts

This is the standalone Foundry workspace for Setryn protocol contracts on Arbitrum.

## Requirements

- Foundry stable
- Solidity 0.8.37, installed automatically by Foundry

## Usage

Run these commands from this directory:

```bash
forge fmt --check
forge build
forge test
```

Use an explicit profile for CI-level fuzz and invariant runs:

```bash
FOUNDRY_PROFILE=ci forge test
```

## Network policy

Development begins locally and on Arbitrum Sepolia. Arbitrum One commands are read-only until the documented launch gate is approved. Deployment scripts must default to simulation and require an explicit `--broadcast` argument for any network write.

Never commit private keys, seed phrases, RPC credentials, or explorer keys.
