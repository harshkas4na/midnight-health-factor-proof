# Private Health-Factor Proof

Built for the **Midnight 1st Buildathon (AKINDO Wave 1)**.

A borrower proves where their lending position sits relative to **their own risk policy** —
without disclosing the collateral, the debt, or the policy threshold itself. The chain learns a
risk *band* and a pseudonymous attestation. It never learns a number.

This attacks Midnight's own stated use case, quoted verbatim from the buildathon brief:

> Finance – Prove solvency, transaction validity, or compliance requirements without disclosing
> balances or counterparties.

## What is new in Wave 1, and what came before it

Wave 1 runs **2026-08-27 to 2026-09-16**. This repository's history splits cleanly at that date,
and `git log` backs every line of the table below.

| Date | Commit | What |
|---|---|---|
| 2026-08-13 | `18a9892` `f331a4b` `b62232c` `73bf406` | **Before the wave.** A 12-line stateless circuit: `proveSolvency(collateral, debt)` cross-multiplied `collateral * 10 >= debt * 12` and wrote one boolean. A Vite/React frontend with Lace wallet integration. Four on-chain tests on the local devnet. |
| 2026-08-30 | `599e95e` `0502365` | Removed a broken `hello-world` scaffold; confirmed the Preview public testnet deployment. Neither commit added Midnight functionality. |
| 2026-09-06 | `78142bb` | **New Midnight functionality.** Witnessed persistent private state, a private risk policy checked against a public protocol floor, four-tier disclosure instead of a boolean, and proof history in public ledger state. `+158 −5` in the Compact circuit, plus a new private-state module. |
| 2026-09-06 | `1bccb5e` | Test suite from 4 cases to 16, including a byte-level assertion that the position and policy never reach public state. `+361` lines. |
| 2026-09-06 | `56592f8` | Frontend rebuilt against the new circuit: a private-policy slider, witness wiring, band display. |

The honest summary: **the original circuit exercised neither private-state management nor
Midnight's dual-ledger model.** Collateral and debt were circuit parameters, the threshold was a
literal in public source, and nothing persisted between calls. The Wave 1 work is the part that
makes it a Midnight application rather than a zero-knowledge predicate that happens to be written
in Compact.

## The dual-ledger split

```
  PRIVATE STATE (local, witnessed)          PUBLIC LEDGER (on chain)
  ────────────────────────────────          ────────────────────────────────
  collateral            987654321           policyFloorBps          12000
  debt                   55555555           proofCount                 14
  policyBps                 98765  ──┐      lastBand                    2
  secretKey        0x8f3a…(32 bytes)  │     bandTally      {0:3,1:2,2:6,3:3}
                                      │     attestations
             witness functions        │       0x4e91… → { band 2, seq 14 }
             read these into      ────┘       0x1c07… → { band 0, seq 11 }
             the circuit
                                          isSolvent                  true
```

Nothing on the right can be run backwards into anything on the left. The test suite asserts this
against the raw serialized on-chain state, not against a description of it.

### Persistent private state via witnesses

`proveRiskBand()` takes **no arguments at all**. Every input arrives through a `witness`:

```compact
witness localPosition(): [Uint<64>, Uint<64>];
witness localPolicyBps(): Uint<64>;
witness localSecretKey(): Bytes<32>;
```

Those are backed by a `HealthFactorPrivateState` record held by the private-state provider
(LevelDB in tests, IndexedDB in the browser) and read fresh on every call. A proof therefore
always reflects the current position, and the position is never something an observer could see
being passed in.

### A private policy, made meaningful by a public floor

The threshold is the interesting secret. A margin desk's risk floor is proprietary: publishing it
tells the market exactly where they get squeezed. So `policyBps` lives in private state.

On its own that would be vacuous — "I am above my own secret threshold" proves nothing if the
threshold can be zero. So the contract publishes a **protocol minimum** at deploy and the circuit
asserts against it:

```compact
export ledger policyFloorBps: Uint<64>;   // 12000 = HF 1.2, public
assert(policyBps >= policyFloorBps, "private policy is laxer than the protocol floor");
```

The prover shows they hold themselves to *at least* the protocol's floor, without showing which
floor. A policy laxer than 1.2 fails inside the circuit, so no proof is produced and nothing
reaches the chain. There is a test for that.

### Tiered disclosure

One boolean can only say "above the floor or not". A band says how much headroom there is, which
is what a counterparty actually wants, and still hides both the amounts and the threshold. Each
band is defined **relative to the prover's own private policy `T`**:

| Band | Name | Condition |
|---|---|---|
| 0 | `LIQUIDATABLE` | `HF < T` |
| 1 | `AT RISK` | `T <= HF < 1.25T` |
| 2 | `SAFE` | `1.25T <= HF < 2T` |
| 3 | `FORTRESS` | `HF >= 2T`, or no debt |

Because the bands are relative, the same position lands in a different band under a stricter
policy — and the public ledger cannot tell whether the position moved or the policy did. That is
a test case, not a claim.

### Proof history on the public ledger

```compact
export ledger proofCount: Counter;
export ledger lastBand: Uint<8>;
export ledger bandTally: Map<Uint<8>, Counter>;
export ledger attestations: Map<Bytes<32>, Attestation>;
```

Repeated proofs accumulate: a monotonic counter, a four-band histogram seeded at deploy, and one
attestation per prover keyed by `persistentHash(domain, secretKey)`. The key is a domain-separated
hash of a witnessed secret, so a prover's attestations are linkable to each other over time and to
nothing else — not to a wallet, not to a position. Each record carries the ledger's own sequence
number rather than a timestamp or an amount.

## Architecture

- **`contracts/health-factor.compact`** — two circuits. `proveRiskBand()` is the Wave 1 work
  described above. `proveSolvency(collateral, debt)` is the original pre-wave circuit, kept
  verbatim so nothing regresses.
- **`contracts/health-factor-private-state.ts`** — the private-state record, the witness
  implementations, and a pure-TypeScript mirror of the band rule (`expectedBand`) so callers can
  predict a result before paying for a proof.
- **`frontend/`** — a Vite/React app: Lace wallet via the Midnight DApp Connector API, sliders for
  collateral, debt and *your own policy threshold*, and a band badge rendered from on-chain
  ledger state.
- **`src/test/health-factor.test.ts`** — 16 end-to-end tests against a really deployed contract.

## Test suite

16 tests, all against a deployed contract on a real chain. Local devnet run, 2026-09-06:

```
 ✓ src/test/health-factor.test.ts (16 tests) 340228ms
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

The four pre-wave cases (`proveSolvency`: safe, unsafe, the exact-1.2 boundary, zero debt) are
unchanged and still green. The twelve added in Wave 1:

- one per disclosed band, driven entirely from private state
- band 3 for a zero-debt position
- the constructor publishes the protocol floor and a four-band histogram
- the same position lands in a different band under a stricter private policy
- a policy laxer than the public floor produces no proof and leaves `proofCount` untouched
- the circuit reads *persisted* state: prove twice with nothing rewritten in between
- proof history accumulates by exactly the right amount in `proofCount` and `bandTally`
- two provers sharing one contract keep separate pseudonymous attestations
- **nothing leaks**: the raw serialized on-chain contract state is fetched and searched
  byte-wise for every plausible encoding of the collateral, the debt and the policy. The test
  carries a positive control — the prover's 32-byte pseudonym, which genuinely *is* public, must
  be found by the same scanner — so a search that silently matches nothing cannot pass as privacy.

## Midnight integration

- Compact contract, compiled with `compact compile` (toolchain 0.5.1 / compiler 0.31.1),
  targeting `language_version 0.23`.
- `witness` functions, a `constructor` with a public argument, `Counter`, `Map<K, Counter>`,
  `Map<Bytes<32>, struct>`, `persistentHash`, and `disclose` as the single explicit boundary
  between private and public.
- Deployed and tested via `@midnight-ntwrk/midnight-js-contracts` (`deployContract`,
  `submitCallTx`) against the local devnet (`yarn env:up` + `yarn test:local`).
- Private state managed through `@midnight-ntwrk/midnight-js-level-private-state-provider`,
  keyed per prover by private-state id.
- The frontend builds its own browser-side provider set (wallet, midnight, proof, public-data,
  zk-config, private-state) directly from the Lace `ConnectedAPI`, following the pattern in
  Midnight's own [leaderboard tutorial](https://docs.midnight.network/tutorials/leaderboard).

## Setup

### Prerequisites

- Node.js v22+
- Docker (for the local devnet / proof server)
- The `compact` CLI: `curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh` then `compact update`
- A Midnight-compatible wallet (Lace) for the frontend

### Contract

```bash
yarn install
yarn compile               # compiles contracts/health-factor.compact (2 circuits)
yarn env:up                # starts the local devnet + proof server (Docker)
yarn test:local            # deploys + runs the 16 end-to-end tests
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
   Technical Gate). Two circuits, not one.
2. `yarn env:up && yarn test:local` — deploys the contract and runs all 16 tests on-chain against
   a local devnet, no external dependencies beyond Docker. The last test is the privacy claim,
   checked against raw on-chain bytes.
3. `cd frontend && yarn install && yarn build && yarn preview` — open the local preview URL,
   connect a Lace wallet, set collateral, debt **and your own policy threshold**, click "Prove
   Risk Band", and watch the band come back off the ledger. Move the policy slider without
   touching the position and prove again: the band changes, and the chain has no way to tell why.
4. `git log --oneline` and `git show 78142bb` — the Wave 1 circuit work as a single diff.

## Deployment status

The Wave 1 circuit is deployed and green on the Preview public testnet:

```
Contract address: 6105510469db1af533fb64c307fd1f810644bd09fd28d38a9489c791e03aefe8
Network:          preview
Deployed:         2026-09-07
Verification:     16/16 tests pass against this deployment
```

**Use this address, not the one from 2026-08-30.** That earlier deployment
(`8df325592ecb958b3e295447359aea3f90419b553d4a4d4e17d60e19a3e40f0c`) was of the pre-wave
twelve-line circuit and still holds it. The Wave 1 circuit has a different verifier key and a
different ledger layout, so it could not be upgraded in place and needed a fresh deploy.

Reproduce with `yarn proof:up && yarn test:preview`, which deploys a new instance and runs all
16 tests against it. Budget the sync: the run on 2026-09-07 resynced ~205,000 blocks and took
about twelve minutes before deploying anything. **It looks like a hang and is not one.** An
earlier attempt on 2026-08-13 was abandoned as "indexer flakiness" when it was simply not
finished. Let it run.

## Scope

**In scope:** a single collateral type, a single debt type, a per-prover private policy floor
above a public protocol minimum, four disclosure bands, proof-of-mechanism only.

**Explicitly out of scope for Wave 1:** real oracle price feeds, a real money-market integration,
multi-asset collateral, cross-chain anything, and any binding between a prover's pseudonym and a
real position held elsewhere. This is a proof-of-mechanism, not a production lending protocol.

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE).
