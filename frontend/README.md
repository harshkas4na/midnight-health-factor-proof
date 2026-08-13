# Private Health-Factor Proof — frontend

Vite/React app for the [health-factor Compact contract](../README.md).

## Run

```bash
yarn install
yarn build && yarn preview
```

`yarn dev` currently fails to render (see `vite.config.ts` — a wasm-bindgen pre-bundling issue
in the ledger SDK, unrelated to this app's code). Use `yarn build && yarn preview` for local
testing until that's resolved upstream.

## Environment

Copy `.env.example` to `.env` (or `.env.local`) and set:

- `VITE_NETWORK_ID` — `undeployed` (local devnet), `preview`, or `preprod`. Defaults to
  `undeployed`.
- `VITE_CONTRACT_ADDRESS` — an already-deployed contract address to connect to instead of
  deploying a fresh instance on every wallet connect.

## Structure

- `src/wallet.ts` — connects to the first Midnight-compatible wallet found under `window.midnight`
  (the DApp Connector API's `InitialAPI`).
- `src/providers.ts` — builds the browser-side provider set (wallet, midnight, proof,
  public-data, zk-config, private-state) from the connected wallet's `ConnectedAPI`.
- `src/contract/` — the compiled contract binding (`managed-contract/` is copied from
  `../contracts/managed/health-factor/contract`) plus `index.ts` wiring it into a
  `CompiledContract`.
- `public/managed/health-factor/` — the compiled ZK artifacts (prover/verifier keys, zkir),
  copied from `../contracts/managed/health-factor`, served statically for
  `FetchZkConfigProvider`.
- `src/App.tsx` — the UI: connect, deploy/find the contract, sliders, prove button, badge.
