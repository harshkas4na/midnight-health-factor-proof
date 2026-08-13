import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import path from 'node:path';

export {
  Contract as HealthFactorContract,
  ledger as healthFactorLedger,
  pureCircuits as healthFactorPureCircuits,
  type Ledger as HealthFactorLedger,
  type ImpureCircuits as HealthFactorImpureCircuits,
  type PureCircuits as HealthFactorPureCircuits,
} from './managed/health-factor/contract/index.js';
import { Contract as HealthFactorContract } from './managed/health-factor/contract/index.js';

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
export const healthFactorZkConfigPath = path.resolve(
  currentDir,
  'managed',
  'health-factor',
);

export const CompiledHealthFactorContract = CompiledContract.make(
  'HealthFactorContract',
  HealthFactorContract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(healthFactorZkConfigPath),
);
