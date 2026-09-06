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
  PROTOCOL_FLOOR_BPS,
  RiskBand,
  expectedBand,
  secretKeyFromLabel,
  type HealthFactorPrivateState,
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

// Two independent provers sharing one deployed contract. Each has its own
// private state -- position, policy and pseudonym secret -- under its own
// private-state id, held by the local private-state provider and never sent
// anywhere. They write to the same public attestation register.
const PRIVATE_STATE_ID = 'AliceHealthFactorState';
const BOB_PRIVATE_STATE_ID = 'BobHealthFactorState';

const ALICE_SECRET = secretKeyFromLabel('alice-health-factor-prover');
const BOB_SECRET = secretKeyFromLabel('bob-health-factor-prover');

/** Alice's baseline private state: HF 2.0 against a private 1.2 policy. */
const aliceInitialState: HealthFactorPrivateState = {
  collateral: 20n,
  debt: 10n,
  policyBps: 12_000n,
  secretKey: ALICE_SECRET,
};

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

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Minimal big-endian and little-endian byte encodings of a bigint, plus the
 * 8-byte zero-padded forms. Used to hunt for a private value inside the raw
 * serialized on-chain contract state.
 */
function candidateEncodings(value: bigint): string[] {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const be = hex;
  const le = (hex.match(/../g) ?? []).reverse().join('');
  const bePadded = hex.padStart(16, '0');
  const lePadded = ((bePadded.match(/../g) ?? []).reverse()).join('');
  return Array.from(new Set([be, le, bePadded, lePadded]));
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

  /** Raw serialized on-chain contract state, as hex. */
  async function rawPublicStateHex(): Promise<string> {
    const state = await providers.publicDataProvider.queryContractState(
      contractAddress,
    );
    expect(state).not.toBeNull();
    const serialize = (state as unknown as { serialize?: () => Uint8Array })
      .serialize;
    expect(typeof serialize).toBe('function');
    return toHex(serialize!.call(state));
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

  /**
   * Writes `state` into the private-state store under `privateStateId`, then
   * calls `proveRiskBand`, which takes no arguments at all: everything the
   * circuit needs it reads back out of that private state through witnesses.
   */
  async function setPrivateState(
    privateStateId: string,
    state: HealthFactorPrivateState,
  ) {
    await providers.privateStateProvider.set(privateStateId, state);
  }

  async function proveRiskBand(privateStateId = PRIVATE_STATE_ID) {
    await (submitCallTx<HealthFactorContract, 'proveRiskBand'>)(providers, {
      compiledContract: CompiledHealthFactorContract,
      contractAddress,
      privateStateId,
      circuitId: 'proveRiskBand',
    });
    return queryLedger(providers);
  }

  async function proveBandFor(
    state: HealthFactorPrivateState,
    privateStateId = PRIVATE_STATE_ID,
  ) {
    await setPrivateState(privateStateId, state);
    return proveRiskBand(privateStateId);
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
        initialPrivateState: aliceInitialState,
        // The public protocol floor, written to public ledger state by the
        // contract constructor.
        args: [PROTOCOL_FLOOR_BPS],
      });

    contractAddress = deployed.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(contractAddress);
    logger.info(`Health factor contract deployed at: ${contractAddress}`);
  });

  afterAll(async () => {
    if (wallet) {
      logger.info('Stopping wallet...');
      await wallet.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Original Wave 1 circuit: a single boolean, amounts passed as circuit
  // parameters. Kept green so the tiered-disclosure work is additive.
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Public ledger state written by the constructor.
  // -------------------------------------------------------------------------

  it('publishes the protocol floor and an empty four-band histogram at deploy', async () => {
    const state = await queryLedger(providers);
    expect(state.policyFloorBps).toBe(PROTOCOL_FLOOR_BPS);
    for (const band of [0n, 1n, 2n, 3n]) {
      expect(state.bandTally.member(band)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Tiered disclosure. One test per band. Nothing is passed to the circuit:
  // every input comes from witnessed private state.
  // -------------------------------------------------------------------------

  it('discloses band 0 (LIQUIDATABLE) for a position under its own policy', async () => {
    // HF = 10/10 = 1.0, private policy 1.2 -> below the floor the prover set.
    const priv: HealthFactorPrivateState = {
      ...aliceInitialState,
      collateral: 10n,
      debt: 10n,
    };
    expect(expectedBand(priv)).toBe(RiskBand.Liquidatable);
    const state = await proveBandFor(priv);
    expect(state.lastBand).toBe(RiskBand.Liquidatable);
    expect(state.isSolvent).toBe(false);
  });

  it('discloses band 1 (AT RISK) for a position just over its own policy', async () => {
    // HF = 13/10 = 1.3. Policy 1.2, so 1.2 <= HF < 1.5.
    const priv: HealthFactorPrivateState = {
      ...aliceInitialState,
      collateral: 13n,
      debt: 10n,
    };
    expect(expectedBand(priv)).toBe(RiskBand.AtRisk);
    const state = await proveBandFor(priv);
    expect(state.lastBand).toBe(RiskBand.AtRisk);
    expect(state.isSolvent).toBe(true);
  });

  it('discloses band 2 (SAFE) for a comfortably collateralized position', async () => {
    // HF = 20/10 = 2.0. Policy 1.2, so 1.5 <= HF < 2.4.
    const priv: HealthFactorPrivateState = {
      ...aliceInitialState,
      collateral: 20n,
      debt: 10n,
    };
    expect(expectedBand(priv)).toBe(RiskBand.Safe);
    const state = await proveBandFor(priv);
    expect(state.lastBand).toBe(RiskBand.Safe);
    expect(state.isSolvent).toBe(true);
  });

  it('discloses band 3 (FORTRESS) for a heavily over-collateralized position', async () => {
    // HF = 100/10 = 10.0. Policy 1.2, so HF >= 2.4.
    const priv: HealthFactorPrivateState = {
      ...aliceInitialState,
      collateral: 100n,
      debt: 10n,
    };
    expect(expectedBand(priv)).toBe(RiskBand.Fortress);
    const state = await proveBandFor(priv);
    expect(state.lastBand).toBe(RiskBand.Fortress);
    expect(state.isSolvent).toBe(true);
  });

  it('discloses band 3 (FORTRESS) when there is no debt at all', async () => {
    const priv: HealthFactorPrivateState = {
      ...aliceInitialState,
      collateral: 5n,
      debt: 0n,
    };
    expect(expectedBand(priv)).toBe(RiskBand.Fortress);
    const state = await proveBandFor(priv);
    expect(state.lastBand).toBe(RiskBand.Fortress);
  });

  // -------------------------------------------------------------------------
  // The private policy is a real input, not decoration.
  // -------------------------------------------------------------------------

  it('reports a different band for the same position under a stricter private policy', async () => {
    // Identical position (HF 2.0) as the SAFE case above, but the prover now
    // holds themselves to HF 2.0 instead of 1.2. Relative to that policy the
    // same position is only AT RISK. The public ledger sees the band change
    // and cannot tell whether the position moved or the policy did.
    const priv: HealthFactorPrivateState = {
      ...aliceInitialState,
      collateral: 20n,
      debt: 10n,
      policyBps: 20_000n,
    };
    expect(expectedBand(priv)).toBe(RiskBand.AtRisk);
    const state = await proveBandFor(priv);
    expect(state.lastBand).toBe(RiskBand.AtRisk);
  });

  it('rejects a proof whose private policy is laxer than the public protocol floor', async () => {
    // Policy 1.0 against a published 1.2 floor. The assert fails inside the
    // circuit, so no proof is produced and nothing reaches the chain.
    const priv: HealthFactorPrivateState = {
      ...aliceInitialState,
      collateral: 1_000n,
      debt: 10n,
      policyBps: 10_000n,
    };
    const before = await queryLedger(providers);
    await setPrivateState(PRIVATE_STATE_ID, priv);
    await expect(proveRiskBand()).rejects.toThrow();
    const after = await queryLedger(providers);
    expect(after.proofCount).toBe(before.proofCount);
  });

  // -------------------------------------------------------------------------
  // Persistent private state.
  // -------------------------------------------------------------------------

  it('reads the position from persistent private state on every call', async () => {
    const priv: HealthFactorPrivateState = {
      ...aliceInitialState,
      collateral: 100n,
      debt: 10n,
    };
    const first = await proveBandFor(priv);
    expect(first.lastBand).toBe(RiskBand.Fortress);

    // Second call with nothing passed in and nothing re-written locally. If
    // the circuit were reading arguments rather than persisted private state
    // this could not work.
    const second = await proveRiskBand();
    expect(second.lastBand).toBe(RiskBand.Fortress);

    const stored = (await providers.privateStateProvider.get(
      PRIVATE_STATE_ID,
    )) as HealthFactorPrivateState | null;
    expect(stored).not.toBeNull();
    expect(stored!.collateral).toBe(100n);
    expect(stored!.debt).toBe(10n);
    expect(stored!.policyBps).toBe(12_000n);
    expect(toHex(stored!.secretKey)).toBe(toHex(ALICE_SECRET));
  });

  // -------------------------------------------------------------------------
  // Proof history accumulating in public ledger state.
  // -------------------------------------------------------------------------

  it('accumulates proof history on the public ledger without recording positions', async () => {
    const before = await queryLedger(providers);
    const beforeSafe = before.bandTally.lookup(RiskBand.Safe).read();
    const beforeFortress = before.bandTally.lookup(RiskBand.Fortress).read();

    await proveBandFor({ ...aliceInitialState, collateral: 20n, debt: 10n });
    const mid = await proveBandFor({
      ...aliceInitialState,
      collateral: 100n,
      debt: 10n,
    });

    expect(mid.proofCount).toBe(before.proofCount + 2n);
    expect(mid.bandTally.lookup(RiskBand.Safe).read()).toBe(beforeSafe + 1n);
    expect(mid.bandTally.lookup(RiskBand.Fortress).read()).toBe(
      beforeFortress + 1n,
    );
  });

  it('keeps one pseudonymous attestation per prover in the shared register', async () => {
    // Alice proves FORTRESS, Bob proves LIQUIDATABLE, on the same contract.
    const aliceLedger = await proveBandFor({
      ...aliceInitialState,
      collateral: 100n,
      debt: 10n,
    });
    expect(aliceLedger.lastBand).toBe(RiskBand.Fortress);

    const bobLedger = await proveBandFor(
      {
        collateral: 10n,
        debt: 10n,
        policyBps: 15_000n,
        secretKey: BOB_SECRET,
      },
      BOB_PRIVATE_STATE_ID,
    );
    expect(bobLedger.lastBand).toBe(RiskBand.Liquidatable);

    const entries = [...bobLedger.attestations];
    expect(entries.length).toBe(2);

    const bands = entries.map(([, a]) => a.band).sort();
    expect(bands).toEqual([RiskBand.Liquidatable, RiskBand.Fortress]);

    // Both attestations are indexed by a 32-byte pseudonym, and the two
    // pseudonyms are distinct.
    const keys = entries.map(([k]) => toHex(k));
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) expect(key.length).toBe(64);

    // Sequence numbers are the ledger's own proof counter, so they order the
    // register without carrying a timestamp or an amount.
    const sequences = entries.map(([, a]) => a.sequence);
    expect(new Set(sequences.map(String)).size).toBe(2);
    expect(sequences.every((s) => s <= bobLedger.proofCount)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // The point of the whole thing: none of it is on the chain.
  // -------------------------------------------------------------------------

  it('never writes the position or the private policy into public state', async () => {
    // Distinctive values, chosen so a byte-level search of the raw on-chain
    // state would find them if they were there.
    const priv: HealthFactorPrivateState = {
      collateral: 987_654_321n,
      debt: 55_555_555n,
      policyBps: 98_765n,
      secretKey: ALICE_SECRET,
    };
    // HF = 17.78 against a private policy of 9.8765, so 1.25T <= HF < 2T.
    expect(expectedBand(priv)).toBe(RiskBand.Safe);

    const state = await proveBandFor(priv);
    expect(state.lastBand).toBe(expectedBand(priv));
    expect(state.lastBand).toBe(RiskBand.Safe);

    // The public ledger exposes exactly these fields and no others.
    expect(Object.keys(state).sort()).toEqual(
      [
        'attestations',
        'bandTally',
        'isSolvent',
        'lastBand',
        'policyFloorBps',
        'proofCount',
      ].sort(),
    );

    const raw = await rawPublicStateHex();

    // Positive control: the scanner can find something that really is public.
    // The prover's 32-byte pseudonym is written to the attestation register,
    // so it must appear in the serialized state.
    const keys = [...state.attestations].map(([k]) => toHex(k));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => raw.includes(k))).toBe(true);

    // Negative: no encoding of the collateral, the debt or the private policy
    // appears anywhere in the raw on-chain state.
    for (const [label, value] of [
      ['collateral', priv.collateral],
      ['debt', priv.debt],
      ['policyBps', priv.policyBps],
    ] as const) {
      for (const encoding of candidateEncodings(value)) {
        expect(
          raw.includes(encoding),
          `${label} (${value}) leaked into public state as ${encoding}`,
        ).toBe(false);
      }
    }

    // The only threshold on chain is the public protocol floor, which is not
    // the prover's policy.
    expect(state.policyFloorBps).toBe(PROTOCOL_FLOOR_BPS);
    expect(state.policyFloorBps).not.toBe(priv.policyBps);
  });
});
