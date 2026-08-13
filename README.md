# Private Health-Factor Proof

Built for the **Midnight 1st Buildathon (AKINDO Wave 1)**.

A lending position proves it's safely collateralized — "health factor ≥ 1.2" — without
revealing the collateral amount, the debt amount, or the wallet's balance to anyone, including
the protocol's own public on-chain state. Only a boolean (`isSolvent`) is ever disclosed.

This attacks Midnight's own stated use case, quoted verbatim from the buildathon brief:

> Finance – Prove solvency, transaction validity, or compliance requirements without disclosing
> balances or counterparties.

## Why this design

Aave-style lending protocols enforce a health-factor floor (collateral / debt ≥ some safety
ratio), but the amounts backing that check are fully public on every EVM chain today — anyone
can read a wallet's exact collateral and debt from the block explorer. This project shows the
same risk check enforced by a smart contract, with the two numbers behind it never touching
public state.

## Architecture

- **`contracts/health-factor.compact`** — a single Compact circuit, `proveSolvency(collateral,
  debt)`. Both arguments are private circuit parameters (private by default in Compact — never
  witnesses, never persisted state). The circuit cross-multiplies to avoid fractional math
  (`collateral * 10 >= debt * 12`, equivalent to `HF >= 1.2`) and discloses only the resulting
  boolean to the public ledger field `isSolvent`.
- **`frontend/`** — a Vite/React app: connects to a Lace wallet via the Midnight DApp Connector
  API, lets you set collateral/debt with sliders, and calls `proveSolvency` on click. The badge
  renders from the on-chain `isSolvent` value — never from the local slider state.
- **`src/test/health-factor.test.ts`** — end-to-end tests against a real deployed contract:
  a safe position, an unsafe position, the exact-1.2 boundary (inclusive), and the zero-debt
  edge case (always solvent).

## Midnight integration

- Compact contract, compiled with `compact compile` (toolchain 0.5.1 / compiler 0.31.1),
  targeting `language_version 0.23`.
- Deployed and tested via `@midnight-ntwrk/midnight-js-contracts` (`deployContract`,
  `submitCallTx`) against both the local devnet (`yarn env:up` + `yarn test:local`) and the
  Preview public testnet (`yarn test:preview`).
- The frontend builds its own browser-side provider set (wallet, midnight, proof, public-data,
  zk-config, private-state) directly from the Lace `ConnectedAPI`, following the pattern in
  Midnight's own [leaderboard tutorial](https://docs.midnight.network/tutorials/leaderboard) —
  see `frontend/src/providers.ts`.

## Setup

### Prerequisites

- Node.js v22+
- Docker (for the local devnet / proof server)
- The `compact` CLI: `curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh` then `compact update`
- A Midnight-compatible wallet (Lace) for the frontend

### Contract

```bash
yarn install
yarn compile              # compiles contracts/health-factor.compact
yarn env:up                # starts the local devnet + proof server (Docker)
yarn test:local             # deploys + runs the 4 end-to-end tests
yarn env:down
```

To run against the Preview testnet instead: fund a wallet via the
[Preview faucet](https://midnight-tmnight-preview.nethermind.dev/) (human-facing page, no
programmatic drip), copy `.env.preview.example` to `.env.preview` with that wallet's seed, then:

```bash
yarn proof:up
yarn test:preview
```

### Frontend

```bash
cd frontend
yarn install
yarn build && yarn preview   # production build + local static server
```

`yarn dev` currently fails to render — a wasm-bindgen dependency pre-bundling issue in Vite's
dev server unrelated to the contract logic, documented in `frontend/vite.config.ts`. The
production build (what's actually deployed) is unaffected.

Set `VITE_CONTRACT_ADDRESS` in `frontend/.env` to skip redeploying and connect to an existing
contract instance; otherwise the app deploys a fresh instance on wallet connect.

## How judges can test this

1. `yarn install && yarn compile` — confirms the Compact contract compiles (the buildathon's
   Technical Gate).
2. `yarn env:up && yarn test:local` — deploys the contract and runs all 4 tests on-chain against
   a local devnet, no external dependencies beyond Docker.
3. `cd frontend && yarn install && yarn build && yarn preview` — open the local preview URL,
   connect a Lace wallet, move the sliders, click "Prove Solvency," and watch the badge flip
   between SAFE and NOT SAFE based on the on-chain disclosed result.

## Progress during Wave 1

Built in a single focused session on 2026-08-13 (Wave 1's opening day): toolchain install,
`health-factor.compact` written and compiled, all 4 on-chain tests passing on local devnet, the
Vite/React frontend with real Lace wallet integration, and this repository set up as a public,
Apache 2.0-licensed, `midnightntwrk`-tagged project. Remaining before the Wave 1 deadline: public
testnet deployment, demo video, and slide deck.

## Scope

**In scope:** a single collateral type, a single debt type, one fixed 1.2 health-factor floor,
proof-of-mechanism only.

**Explicitly out of scope for Wave 1:** real oracle price feeds, a real money-market
integration, multi-asset collateral, cross-chain anything. This is a proof-of-mechanism, not a
production lending protocol.

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE).
