import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type MidnightWalletProvider } from './wallet.js';
import { type NetworkConfig } from './config.js';

export type HealthFactorCircuits = 'proveSolvency';

export type HealthFactorProviders = MidnightProviders<any>;

export function buildProviders(
    wallet: MidnightWalletProvider,
    zkConfigPath: string,
    config: NetworkConfig,
): HealthFactorProviders {
    const zkConfigProvider = new NodeZkConfigProvider<HealthFactorCircuits>(zkConfigPath);

    return {
        privateStateProvider: levelPrivateStateProvider({
            privateStateStoreName: `health-factor-${Date.now()}`,
            privateStoragePasswordProvider: () => 'Health-Factor-Test-Password',
            accountId: wallet.getCoinPublicKey(),
        }),
        publicDataProvider: indexerPublicDataProvider(
            config.indexer,
            config.indexerWS,
        ),
        zkConfigProvider,
        proofProvider: httpClientProofProvider(
            config.proofServer,
            zkConfigProvider,
        ),
        walletProvider: wallet,
        midnightProvider: wallet,
    };
}