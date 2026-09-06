import { useCallback, useMemo, useState } from 'react';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  findDeployedContract,
  submitCallTx,
  type DeployedContract,
  type FoundContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { connectToWallet } from './wallet';
import { buildProviders, type HealthFactorProviders } from './providers';
import {
  CompiledHealthFactorContract,
  healthFactorLedger,
  PROTOCOL_FLOOR_BPS,
  RISK_BAND_BLURBS,
  RISK_BAND_LABELS,
  expectedBand,
  randomSecretKey,
  type HealthFactorContract,
  type HealthFactorPrivateState,
} from './contract';
import './App.css';

const NETWORK_ID = import.meta.env.VITE_NETWORK_ID ?? 'undeployed';
const EXISTING_CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as
  | string
  | undefined;
const PRIVATE_STATE_ID = 'HealthFactorPrivateState';

const bandClass = (band: bigint): string =>
  band >= 2n ? 'safe' : band === 1n ? 'warn' : 'unsafe';

function App() {
  const [connectedAPI, setConnectedAPI] = useState<ConnectedAPI | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [providers, setProviders] = useState<HealthFactorProviders | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [collateral, setCollateral] = useState(20);
  const [debt, setDebt] = useState(10);
  // The user's own health-factor policy. This is the number the whole design
  // exists to keep private: it stays in local private state, and the circuit
  // only proves it is at least as strict as the public protocol floor.
  const [policy, setPolicy] = useState(1.2);
  const [band, setBand] = useState<bigint | null>(null);
  const [proofCount, setProofCount] = useState<bigint | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const healthFactor = debt === 0 ? Infinity : collateral / debt;
  const policyBps = BigInt(Math.round(policy * 10_000));

  const privateState: HealthFactorPrivateState = useMemo(
    () => ({
      collateral: BigInt(collateral),
      debt: BigInt(debt),
      policyBps,
      secretKey: randomSecretKey(),
    }),
    // A fresh pseudonym per position change keeps the demo unlinkable; a real
    // wallet would persist one secret and reuse it.
    [collateral, debt, policyBps],
  );

  const predictedBand = useMemo(() => expectedBand(privateState), [privateState]);
  const policyTooLax = policyBps < PROTOCOL_FLOOR_BPS;

  const connect = useCallback(async () => {
    setError(null);
    setBusy(true);
    setStatus('Connecting to Lace wallet...');
    try {
      setNetworkId(NETWORK_ID);
      const api = await connectToWallet(NETWORK_ID);
      const { unshieldedAddress } = await api.getUnshieldedAddress();
      const p = await buildProviders(api);

      setStatus(
        EXISTING_CONTRACT_ADDRESS
          ? 'Connecting to the deployed health-factor contract...'
          : 'Deploying the health-factor contract to the network...',
      );

      const initialPrivateState: HealthFactorPrivateState = {
        collateral: BigInt(collateral),
        debt: BigInt(debt),
        policyBps,
        secretKey: randomSecretKey(),
      };

      let deployedAddress: string;
      if (EXISTING_CONTRACT_ADDRESS) {
        const found: FoundContract<HealthFactorContract> =
          await (findDeployedContract<HealthFactorContract>)(p, {
            contractAddress: EXISTING_CONTRACT_ADDRESS,
            compiledContract: CompiledHealthFactorContract,
            privateStateId: PRIVATE_STATE_ID,
            initialPrivateState,
          });
        deployedAddress = found.deployTxData.public.contractAddress;
      } else {
        const deployed: DeployedContract<HealthFactorContract> =
          await (deployContract<HealthFactorContract>)(p, {
            compiledContract: CompiledHealthFactorContract,
            privateStateId: PRIVATE_STATE_ID,
            initialPrivateState,
            // The public protocol floor, written to ledger state at deploy.
            args: [PROTOCOL_FLOOR_BPS],
          });
        deployedAddress = deployed.deployTxData.public.contractAddress;
      }

      p.privateStateProvider.setContractAddress(deployedAddress);

      setConnectedAPI(api);
      setAddress(unshieldedAddress);
      setProviders(p);
      setContractAddress(deployedAddress);
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [collateral, debt, policyBps]);

  const proveRiskBand = useCallback(async () => {
    if (!providers || !contractAddress) return;
    setError(null);
    setBusy(true);
    setStatus('Writing private state, generating proof, submitting...');
    try {
      // Position and policy go into local private state. The circuit call
      // below passes no arguments at all -- it reads them back through
      // witnesses, so neither number is ever part of the transaction.
      await providers.privateStateProvider.set(PRIVATE_STATE_ID, privateState);

      await submitCallTx<HealthFactorContract, 'proveRiskBand'>(providers, {
        compiledContract: CompiledHealthFactorContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId: 'proveRiskBand',
      });

      const state = await providers.publicDataProvider.queryContractState(
        contractAddress,
      );
      if (!state) throw new Error('Contract state not found on the indexer.');
      const ledger = healthFactorLedger(state.data);
      setBand(ledger.lastBand);
      setProofCount(ledger.proofCount);
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [providers, contractAddress, privateState]);

  return (
    <div className="app">
      <header>
        <h1>Private Health-Factor Proof</h1>
        <p className="tagline">
          Prove where a lending position sits relative to your own risk policy,
          without disclosing the position <em>or</em> the policy. Built on
          Midnight (Compact) for the 1st Buildathon.
        </p>
      </header>

      {!connectedAPI ? (
        <button className="primary" onClick={connect} disabled={busy}>
          {busy ? 'Connecting...' : 'Connect Lace Wallet'}
        </button>
      ) : (
        <div className="wallet-info">
          <span className="dot" />
          Connected: {address?.slice(0, 10)}...{address?.slice(-6)}
          <br />
          Contract: {contractAddress?.slice(0, 10)}...{contractAddress?.slice(-6)}
          {proofCount !== null && (
            <>
              <br />
              Proofs recorded on the public ledger: {proofCount.toString()}
            </>
          )}
        </div>
      )}

      {status && <p className="status">{status}</p>}
      {error && <p className="error">{error}</p>}

      <section className={`playground ${!contractAddress ? 'disabled' : ''}`}>
        <label>
          Collateral: {collateral}
          <input
            type="range"
            min={0}
            max={100}
            value={collateral}
            disabled={!contractAddress || busy}
            onChange={(e) => setCollateral(Number(e.target.value))}
          />
        </label>
        <label>
          Debt: {debt}
          <input
            type="range"
            min={0}
            max={100}
            value={debt}
            disabled={!contractAddress || busy}
            onChange={(e) => setDebt(Number(e.target.value))}
          />
        </label>
        <label>
          Your private policy: HF &ge; {policy.toFixed(1)}
          <input
            type="range"
            min={1.0}
            max={4.0}
            step={0.1}
            value={policy}
            disabled={!contractAddress || busy}
            onChange={(e) => setPolicy(Number(e.target.value))}
          />
        </label>

        <p className="hf-preview">
          Health factor (local, never sent):{' '}
          {healthFactor === Infinity ? '∞' : healthFactor.toFixed(2)}
          {' · '}
          predicted band: {RISK_BAND_LABELS[predictedBand.toString()]}
        </p>

        {policyTooLax && (
          <p className="error">
            The public protocol floor is HF 1.2. A policy laxer than that fails
            the assert inside the circuit, so no proof is produced.
          </p>
        )}

        <button
          className="primary"
          onClick={proveRiskBand}
          disabled={!contractAddress || busy}
        >
          {busy ? 'Proving...' : 'Prove Risk Band'}
        </button>

        {band !== null && (
          <div className={`badge ${bandClass(band)}`}>
            {RISK_BAND_LABELS[band.toString()]}
            <span className="badge-sub">
              {RISK_BAND_BLURBS[band.toString()]}
            </span>
          </div>
        )}
      </section>

      <footer>
        Collateral, debt and your policy threshold live in local private state
        and are read by the circuit through witnesses. Only the band and a
        pseudonymous attestation are ever written on-chain.
      </footer>
    </div>
  );
}

export default App;
