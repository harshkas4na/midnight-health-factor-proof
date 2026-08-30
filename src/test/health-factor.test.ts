import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  type EnvironmentConfiguration,
  waitForFunds,
} from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from '../config.js';
import {
  MidnightWalletProvider,
  syncWallet,
  type WalletSecret,
} from '../wallet.js';
import { buildProviders, type HealthFactorProviders } from '../providers.js';
import {
  CompiledHealthFactorContract,
  HealthFactorContract,
  healthFactorLedger,
  healthFactorZkConfigPath,
} from '../../contracts/health-factor-index.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  console.error('Promise:', promise);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const ALICE_LOCAL_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';
const PRIVATE_STATE_ID = 'AliceHealthFactorState';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

function resolveSecret(net: string): WalletSecret {
  if (net === 'local') return { kind: 'seed', value: ALICE_LOCAL_SEED };

  const upper = net.toUpperCase();
  const mnemonicEnv = `MIDNIGHT_${upper}_MNEMONIC`;
  const seedEnv = `MIDNIGHT_${upper}_SEED`;
  const mnemonic = process.env[mnemonicEnv]?.trim().replace(/\s+/g, ' ');
  const seedHex = process.env[seedEnv]?.trim();

  if (mnemonic && seedHex) {
    throw new Error(
      `Set only one of ${mnemonicEnv} or ${seedEnv} (both are defined).`,
    );
  }
  if (mnemonic) {
    return { kind: 'mnemonic', value: mnemonic };
  }
  if (seedHex) {
    if (!/^[0-9a-fA-F]+$/.test(seedHex) || seedHex.length % 2 !== 0) {
      throw new Error(
        `${seedEnv} must be a hex string of even length (no 0x prefix).`,
      );
    }
    return { kind: 'seed', value: seedHex };
  }
  throw new Error(
    `Either ${mnemonicEnv} or ${seedEnv} is required for network '${net}'. ` +
      `Set one in .env.${net} or the shell.`,
  );
}

describe(`Health Factor Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: HealthFactorProviders;
  let contractAddress: ContractAddress;

  const config = getConfig();
  const secret = resolveSecret(network);
  const isRemote = network !== 'local';
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ??
      (isRemote ? 60 * 60_000 : 10 * 60_000),
  );

  async function queryLedger(p: HealthFactorProviders) {
    const state = await p.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return healthFactorLedger(state!.data);
  }

  async function proveSolvency(collateral: bigint, debt: bigint) {
    await (submitCallTx<HealthFactorContract, 'proveSolvency'>)(providers, {
      compiledContract: CompiledHealthFactorContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'proveSolvency',
      args: [collateral, debt],
    });
    return queryLedger(providers);
  }

  beforeAll(async () => {
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

    wallet = await MidnightWalletProvider.build(logger, envConfig, secret);
    await wallet.start();
    await syncWallet(logger, wallet.wallet, syncTimeoutMs);

    if (isRemote) {
      const nightBalance = await waitForFunds(
        wallet.wallet,
        envConfig,
        false,
        wallet.unshieldedKeystore,
      );
      logger.info(`Wallet NIGHT balance on '${network}': ${nightBalance}`);
    }

    providers = buildProviders(wallet, healthFactorZkConfigPath, config);
    logger.info(`Providers initialized on '${network}'. Ready to test!`);

    const deployed: DeployedContract<HealthFactorContract> =
      await (deployContract<HealthFactorContract>)(providers, {
        compiledContract: CompiledHealthFactorContract,
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: {},
      });

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Health factor contract deployed at: ${contractAddress}`);
  });

  afterAll(async () => {
    if (wallet) {
      logger.info('Stopping wallet...');
      await wallet.stop();
    }
  });

  it('marks a well-collateralized position as solvent', async () => {
    // HF = 20/10 = 2.0 >= 1.2
    const state = await proveSolvency(20n, 10n);
    expect(state.isSolvent).toBe(true);
  });

  it('marks an under-collateralized position as not solvent', async () => {
    // HF = 10/10 = 1.0 < 1.2
    const state = await proveSolvency(10n, 10n);
    expect(state.isSolvent).toBe(false);
  });

  it('treats HF exactly at the 1.2 threshold as solvent (inclusive)', async () => {
    // HF = 12/10 = 1.2 -- boundary case, should be SAFE
    const state = await proveSolvency(12n, 10n);
    expect(state.isSolvent).toBe(true);
  });

  it('treats zero debt as always solvent', async () => {
    const state = await proveSolvency(5n, 0n);
    expect(state.isSolvent).toBe(true);
  });
});
