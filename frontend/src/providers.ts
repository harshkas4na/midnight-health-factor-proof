import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { toHex, fromHex } from '@midnight-ntwrk/midnight-js-utils';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { healthFactorZkConfigUrl, type HealthFactorContract } from './contract';

export type HealthFactorProviders = MidnightProviders<
  'proveSolvency',
  'HealthFactorPrivateState',
  Record<string, never>
>;

export async function buildProviders(
  connectedAPI: ConnectedAPI,
): Promise<HealthFactorProviders> {
  const config = await connectedAPI.getConfiguration();
  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } =
    await connectedAPI.getShieldedAddresses();

  const proverServerUri =
    config.proverServerUri ?? 'http://127.0.0.1:6300';

  const zkConfigProvider = new FetchZkConfigProvider<'proveSolvency'>(
    healthFactorZkConfigUrl,
  );

  return {
    // The contract has no real private state (collateral/debt are one-shot circuit
    // params, never persisted) -- this store only backs midnight-js's bookkeeping
    // (e.g. the maintenance-authority signing key created on deploy).
    privateStateProvider: levelPrivateStateProvider<
      'HealthFactorPrivateState',
      Record<string, never>
    >({
      privateStateStoreName: 'health-factor-private-state',
      accountId: shieldedCoinPublicKey,
      privateStoragePasswordProvider: () =>
        Promise.resolve('health-factor-demo-local-Storage9!'),
    }),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(proverServerUri, zkConfigProvider),
    publicDataProvider: indexerPublicDataProvider(
      config.indexerUri,
      config.indexerWsUri,
    ),
    walletProvider: {
      getCoinPublicKey: () => shieldedCoinPublicKey,
      getEncryptionPublicKey: () => shieldedEncryptionPublicKey,
      balanceTx: async (tx) => {
        const received = await connectedAPI.balanceUnsealedTransaction(
          toHex(tx.serialize()),
        );
        return Transaction.deserialize(
          'signature',
          'proof',
          'binding',
          fromHex(received.tx),
        );
      },
    },
    midnightProvider: {
      submitTx: async (tx) => {
        await connectedAPI.submitTransaction(toHex(tx.serialize()));
        return tx.identifiers()[0];
      },
    },
  } satisfies HealthFactorProviders;
}

export type { HealthFactorContract };
