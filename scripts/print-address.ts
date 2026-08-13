import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  type EnvironmentConfiguration,
  FluentWalletBuilder,
} from '@midnight-ntwrk/testkit-js';
import { getConfig } from '../src/config.js';

const seed = process.argv[2];
if (!seed) {
  console.error('Usage: vite-node scripts/print-address.ts <hex-seed>');
  process.exit(1);
}

const config = getConfig();
setNetworkId(config.networkId);

const envConfig: EnvironmentConfiguration = {
  walletNetworkId: config.networkId,
  networkId: config.networkId,
  indexer: config.indexer,
  indexerWS: config.indexerWS,
  node: config.node,
  nodeWS: config.nodeWS,
  faucet: config.faucet,
  proofServer: config.proofServer,
};

const { keystore } = (await FluentWalletBuilder.forEnvironment(envConfig)
  .withSeed(seed)
  .buildWithoutStarting()) as { keystore: { getBech32Address(): string } };

console.log(`network: ${config.networkId}`);
console.log(`address: ${keystore.getBech32Address()}`);
process.exit(0);
