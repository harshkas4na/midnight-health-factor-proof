import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  localPosition(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, [bigint,
                                                                             bigint]];
  localPolicyBps(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  localSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  proveRiskBand(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  proveSolvency(context: __compactRuntime.CircuitContext<PS>,
                collateral_0: bigint,
                debt_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  proveRiskBand(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  proveSolvency(context: __compactRuntime.CircuitContext<PS>,
                collateral_0: bigint,
                debt_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  proveRiskBand(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  proveSolvency(context: __compactRuntime.CircuitContext<PS>,
                collateral_0: bigint,
                debt_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly policyFloorBps: bigint;
  readonly proofCount: bigint;
  readonly lastBand: bigint;
  bandTally: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): { read(): bigint }
  };
  attestations: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): { band: bigint, sequence: bigint };
    [Symbol.iterator](): Iterator<[Uint8Array, { band: bigint, sequence: bigint }]>
  };
  readonly isSolvent: boolean;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               floorBps_0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
