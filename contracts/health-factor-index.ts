import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import path from 'node:path';

import { healthFactorWitnesses } from './health-factor-private-state.js';

export {
  Contract as HealthFactorContract,
  ledger as healthFactorLedger,
  pureCircuits as healthFactorPureCircuits,
  type Ledger as HealthFactorLedger,
  type ImpureCircuits as HealthFactorImpureCircuits,
  type PureCircuits as HealthFactorPureCircuits,
} from './managed/health-factor/contract/index.js';
import { Contract as HealthFactorContract } from './managed/health-factor/contract/index.js';

export * from './health-factor-private-state.js';

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
export const healthFactorZkConfigPath = path.resolve(
  currentDir,
  'managed',
  'health-factor',
);

/**
 * The protocol's public minimum health-factor floor, in basis points.
 * Passed to the contract constructor at deploy and written to public ledger
 * state; every prover's private policy must be at least this strict.
 */
export const PROTOCOL_FLOOR_BPS = 12_000n;

export const CompiledHealthFactorContract = CompiledContract.make(
  'HealthFactorContract',
  HealthFactorContract,
).pipe(
  (c) => CompiledContract.withWitnesses(c, healthFactorWitnesses as never),
  CompiledContract.withCompiledFileAssets(healthFactorZkConfigPath),
);
