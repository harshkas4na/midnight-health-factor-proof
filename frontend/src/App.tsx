import { useCallback, useState } from 'react';
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
import { CompiledHealthFactorContract, type HealthFactorContract } from './contract';
import './App.css';

const NETWORK_ID = import.meta.env.VITE_NETWORK_ID ?? 'undeployed';
const EXISTING_CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as
  | string
  | undefined;
const PRIVATE_STATE_ID = 'HealthFactorPrivateState';

type Solvency = 'unknown' | 'safe' | 'unsafe';

function App() {
  const [connectedAPI, setConnectedAPI] = useState<ConnectedAPI | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [providers, setProviders] = useState<HealthFactorProviders | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [collateral, setCollateral] = useState(20);
  const [debt, setDebt] = useState(10);
  const [solvency, setSolvency] = useState<Solvency>('unknown');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const healthFactor = debt === 0 ? Infinity : collateral / debt;

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

      let deployedAddress: string;
      if (EXISTING_CONTRACT_ADDRESS) {
        const found: FoundContract<HealthFactorContract> =
          await (findDeployedContract<HealthFactorContract>)(p, {
            contractAddress: EXISTING_CONTRACT_ADDRESS,
            compiledContract: CompiledHealthFactorContract,
            privateStateId: PRIVATE_STATE_ID,
            initialPrivateState: {},
          });
        deployedAddress = found.deployTxData.public.contractAddress;
      } else {
        const deployed: DeployedContract<HealthFactorContract> =
          await (deployContract<HealthFactorContract>)(p, {
            compiledContract: CompiledHealthFactorContract,
            privateStateId: PRIVATE_STATE_ID,
            initialPrivateState: {},
          });
        deployedAddress = deployed.deployTxData.public.contractAddress;
      }

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
  }, []);

  const proveSolvency = useCallback(async () => {
    if (!providers || !contractAddress) return;
    setError(null);
    setBusy(true);
    setStatus('Generating proof and submitting to the network...');
    try {
      await submitCallTx<HealthFactorContract, 'proveSolvency'>(providers, {
        compiledContract: CompiledHealthFactorContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId: 'proveSolvency',
        args: [BigInt(collateral), BigInt(debt)],
      });

      const state = await providers.publicDataProvider.queryContractState(
        contractAddress,
      );
      const isSolvent = Boolean((state?.data as { isSolvent?: boolean })?.isSolvent);
      setSolvency(isSolvent ? 'safe' : 'unsafe');
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [providers, contractAddress, collateral, debt]);

  return (
    <div className="app">
      <header>
        <h1>Private Health-Factor Proof</h1>
        <p className="tagline">
          Prove a lending position is solvent (HF &ge; 1.2) without ever disclosing
          collateral or debt. Built on Midnight (Compact) for the 1st Buildathon.
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

        <p className="hf-preview">
          Health factor (local, never sent as-is):{' '}
          {healthFactor === Infinity ? '∞' : healthFactor.toFixed(2)}
        </p>

        <button
          className="primary"
          onClick={proveSolvency}
          disabled={!contractAddress || busy}
        >
          {busy ? 'Proving...' : 'Prove Solvency'}
        </button>

        {solvency !== 'unknown' && (
          <div className={`badge ${solvency}`}>
            {solvency === 'safe'
              ? 'Health Factor ≥ 1.2 — SAFE'
              : 'Health Factor < 1.2 — NOT SAFE'}
          </div>
        )}
      </section>

      <footer>
        Collateral and debt are private circuit parameters &mdash; only the
        boolean result above is ever written on-chain.
      </footer>
    </div>
  );
}

export default App;
