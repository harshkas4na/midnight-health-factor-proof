import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

import { healthFactorWitnesses } from './privateState';

export {
  Contract as HealthFactorContract,
  ledger as healthFactorLedger,
  type Ledger as HealthFactorLedger,
} from './managed-contract/index.js';
import { Contract as HealthFactorContract } from './managed-contract/index.js';

export * from './privateState';

export const healthFactorZkConfigUrl = `${window.location.origin}/managed/health-factor`;

/**
 * The protocol's public minimum health-factor floor, in basis points, passed
 * to the contract constructor at deploy. Every user's private policy must be
 * at least this strict.
 */
export const PROTOCOL_FLOOR_BPS = 12_000n;

// withCompiledFileAssets is required to fully resolve the CompiledContract's type
// (R = never), but the path itself is unused here -- key/zkir fetching goes through
// providers.zkConfigProvider (FetchZkConfigProvider hitting /managed/health-factor).
export const CompiledHealthFactorContract = CompiledContract.make(
  'HealthFactorContract',
  HealthFactorContract,
).pipe(
  (c) => CompiledContract.withWitnesses(c, healthFactorWitnesses as never),
  CompiledContract.withCompiledFileAssets('health-factor'),
);
