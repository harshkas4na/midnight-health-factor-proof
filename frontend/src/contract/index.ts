import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

export {
  Contract as HealthFactorContract,
  ledger as healthFactorLedger,
  type Ledger as HealthFactorLedger,
} from './managed-contract/index.js';
import { Contract as HealthFactorContract } from './managed-contract/index.js';

export const healthFactorZkConfigUrl = `${window.location.origin}/managed/health-factor`;

// withCompiledFileAssets is required to fully resolve the CompiledContract's type
// (R = never), but the path itself is unused here -- key/zkir fetching goes through
// providers.zkConfigProvider (FetchZkConfigProvider hitting /managed/health-factor).
export const CompiledHealthFactorContract = CompiledContract.make(
  'HealthFactorContract',
  HealthFactorContract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets('health-factor'),
);
