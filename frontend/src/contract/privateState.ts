import type { Ledger } from './managed-contract/index.js';

/**
 * Browser-side mirror of the contract's private state. Held by the local
 * private-state provider (IndexedDB via level), read into the circuit through
 * the witnesses below, and never included in a transaction.
 */
export type HealthFactorPrivateState = {
  readonly collateral: bigint;
  readonly debt: bigint;
  /** The user's own health-factor policy, in basis points. 12000 = HF 1.2. */
  readonly policyBps: bigint;
  /** Secret behind the on-chain pseudonym. 32 bytes. */
  readonly secretKey: Uint8Array;
};

export const BPS = 10_000n;

export const RiskBand = {
  Liquidatable: 0n,
  AtRisk: 1n,
  Safe: 2n,
  Fortress: 3n,
} as const;

export const RISK_BAND_LABELS: Record<string, string> = {
  '0': 'LIQUIDATABLE',
  '1': 'AT RISK',
  '2': 'SAFE',
  '3': 'FORTRESS',
};

export const RISK_BAND_BLURBS: Record<string, string> = {
  '0': 'Below your own policy floor.',
  '1': 'Above your floor, but thin.',
  '2': 'Comfortable headroom.',
  '3': 'Strongly over-collateralised.',
};

/**
 * A fresh 32-byte pseudonym secret. Persisted alongside the position so the
 * same browser keeps the same on-chain identity across proofs.
 */
export function randomSecretKey(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * The band the circuit will disclose, computed locally so the UI can show the
 * answer before paying for a proof. Mirrors the ternary chain in
 * `proveRiskBand`.
 */
export function expectedBand(state: HealthFactorPrivateState): bigint {
  const { collateral, debt, policyBps } = state;
  if (debt === 0n) return RiskBand.Fortress;
  const scaled = collateral * BPS;
  const floor = debt * policyBps;
  if (scaled >= floor * 2n) return RiskBand.Fortress;
  if (scaled * 100n >= floor * 125n) return RiskBand.Safe;
  if (scaled >= floor) return RiskBand.AtRisk;
  return RiskBand.Liquidatable;
}

type Ctx = { privateState: HealthFactorPrivateState; ledger: Ledger };

export const healthFactorWitnesses = {
  localPosition: ({ privateState }: Ctx): [HealthFactorPrivateState, [bigint, bigint]] => [
    privateState,
    [privateState.collateral, privateState.debt],
  ],
  localPolicyBps: ({ privateState }: Ctx): [HealthFactorPrivateState, bigint] => [
    privateState,
    privateState.policyBps,
  ],
  localSecretKey: ({ privateState }: Ctx): [HealthFactorPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],
};
