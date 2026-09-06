import { createHash, randomBytes } from 'node:crypto';

import type { Ledger } from './managed/health-factor/contract/index.js';

/**
 * Everything the health-factor circuits are allowed to know but the chain is
 * not. This object is held by the private-state provider (a local LevelDB
 * store), keyed by a private-state id, and is read back into the circuit on
 * every call through the `witness` functions below. It is never serialized
 * into a transaction.
 */
export type HealthFactorPrivateState = {
  /** Collateral posted, in whole units. */
  readonly collateral: bigint;
  /** Debt outstanding, in whole units. */
  readonly debt: bigint;
  /**
   * The borrower's own health-factor policy in basis points (12000 = HF 1.2).
   * The circuit proves this is at least as strict as the public
   * `policyFloorBps` without disclosing it.
   */
  readonly policyBps: bigint;
  /** Secret behind the prover's on-chain pseudonym. 32 bytes. */
  readonly secretKey: Uint8Array;
};

/** Basis-point scale used throughout: 10000 bps = health factor 1.0. */
export const BPS = 10_000n;

/** The disclosed risk bands, mirroring the comment block in the circuit. */
export const RiskBand = {
  Liquidatable: 0n,
  AtRisk: 1n,
  Safe: 2n,
  Fortress: 3n,
} as const;

export type RiskBandValue = (typeof RiskBand)[keyof typeof RiskBand];

export const RISK_BAND_LABELS: Record<string, string> = {
  '0': 'LIQUIDATABLE',
  '1': 'AT RISK',
  '2': 'SAFE',
  '3': 'FORTRESS',
};

/**
 * Derives a deterministic 32-byte secret key from a label, so tests and demos
 * get a stable pseudonym without a key-management story. Real deployments
 * should use `randomSecretKey()` and persist the result.
 */
export function secretKeyFromLabel(label: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(label).digest());
}

export function randomSecretKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

export function createPrivateState(
  collateral: bigint,
  debt: bigint,
  policyBps: bigint,
  secretKey: Uint8Array,
): HealthFactorPrivateState {
  return { collateral, debt, policyBps, secretKey };
}

/**
 * The band the circuit will disclose for a given private state. Pure TypeScript
 * mirror of the circuit's ternary chain, used by tests and the UI to predict
 * the result before paying for a proof. Kept in this file, next to the private
 * state it reads, so the two stay in step.
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

/**
 * Witness implementations. Each receives the circuit's witness context and
 * returns `[nextPrivateState, value]`. All three are pure reads: the position
 * and policy are updated out-of-band by the application (see
 * `withPosition`/`withPolicy`), not as a side effect of proving, which keeps a
 * failed or re-run proof from mutating local state.
 */
export const healthFactorWitnesses = {
  localPosition: ({
    privateState,
  }: {
    privateState: HealthFactorPrivateState;
    ledger: Ledger;
  }): [HealthFactorPrivateState, [bigint, bigint]] => [
    privateState,
    [privateState.collateral, privateState.debt],
  ],

  localPolicyBps: ({
    privateState,
  }: {
    privateState: HealthFactorPrivateState;
    ledger: Ledger;
  }): [HealthFactorPrivateState, bigint] => [privateState, privateState.policyBps],

  localSecretKey: ({
    privateState,
  }: {
    privateState: HealthFactorPrivateState;
    ledger: Ledger;
  }): [HealthFactorPrivateState, Uint8Array] => [privateState, privateState.secretKey],
};

/** Returns a copy of `state` with a new position. */
export function withPosition(
  state: HealthFactorPrivateState,
  collateral: bigint,
  debt: bigint,
): HealthFactorPrivateState {
  return { ...state, collateral, debt };
}

/** Returns a copy of `state` with a new private policy threshold. */
export function withPolicy(
  state: HealthFactorPrivateState,
  policyBps: bigint,
): HealthFactorPrivateState {
  return { ...state, policyBps };
}
