import type {
  Address,
  Bytes32,
  JsonObject,
  RegistryKind,
  RegistryStatus,
  ProtocolEventDomain,
} from "@setryn/internal-schemas";

export interface RegistryVersionProjection {
  readonly chainId: number;
  readonly registry: RegistryKind;
  readonly entityId: Bytes32;
  readonly version: number;
  readonly versionHash: Bytes32 | null;
  readonly definitionHash: Bytes32;
  readonly status: RegistryStatus;
  readonly definition: JsonObject;
  readonly registeredBy: Address;
  readonly registeredAtBlock: bigint;
  readonly updatedAtBlock: bigint;
}

export interface RegistryHeadProjection {
  readonly chainId: number;
  readonly registry: RegistryKind;
  readonly entityId: Bytes32;
  readonly activeVersion: number;
  readonly updatedAtBlock: bigint;
}

export interface CollateralAccountProjection {
  readonly chainId: number;
  readonly accountId: Bytes32;
  readonly controller: Address;
  readonly pendingController: Address | null;
  readonly lockOperatorEpoch: number;
  readonly createdAtBlock: bigint;
  readonly updatedAtBlock: bigint;
}

export interface LockOperatorProjection {
  readonly chainId: number;
  readonly accountId: Bytes32;
  readonly operator: Address;
  readonly approved: boolean;
  readonly epoch: number;
  readonly controller: Address;
  readonly updatedAtBlock: bigint;
}

export interface CollateralBalanceProjection {
  readonly chainId: number;
  readonly accountId: Bytes32;
  readonly collateralId: Bytes32;
  readonly total: string;
  readonly preTradeLocked: string;
  readonly terminalReserved: string;
  readonly terminalClaimBacking: string;
  readonly updatedAtBlock: bigint;
}

export interface ExcessRecoveryProjection {
  readonly chainId: number;
  readonly token: Address;
  readonly assetId: Bytes32;
  readonly bindingVersion: number;
  readonly totalRecovered: string;
  readonly tokenLiability: string;
  readonly lastRecipient: Address;
  readonly lastOperator: Address;
  readonly updatedAtBlock: bigint;
}

export interface CollateralLockProjection {
  readonly chainId: number;
  readonly lockId: Bytes32;
  readonly accountId: Bytes32;
  readonly collateralId: Bytes32;
  readonly amount: string;
  readonly remainingAmount: string;
  readonly status: string;
  readonly settlementOperator: Address;
  readonly updatedAtBlock: bigint;
}

export interface TerminalReservationProjection {
  readonly chainId: number;
  readonly reservationId: Bytes32;
  readonly positionId: Bytes32;
  readonly payerAccountId: Bytes32;
  readonly collateralId: Bytes32;
  readonly amount: string;
  readonly terminalAmount: string | null;
  readonly releasedAmount: string | null;
  readonly terminalAccountId: Bytes32 | null;
  readonly terminalOutcomeReference: Bytes32 | null;
  readonly terminalOutcome: string | null;
  readonly status: string;
  readonly creator: Address;
  readonly positionEngine: Address;
  readonly sourceLockId: Bytes32;
  readonly updatedAtBlock: bigint;
}

export interface TerminalClaimProjection {
  readonly chainId: number;
  readonly claimId: Bytes32;
  readonly reservationId: Bytes32;
  readonly positionId: Bytes32;
  readonly payerAccountId: Bytes32;
  readonly receiverAccountId: Bytes32;
  readonly collateralId: Bytes32;
  readonly terminalOutcomeReference: Bytes32;
  readonly amount: string;
  readonly status: string;
  readonly updatedAtBlock: bigint;
}

export interface DeploymentProjection {
  readonly environment: string;
  readonly chainId: number;
  readonly contractName: string;
  readonly artifact: string;
  readonly address: Address;
  readonly runtimeCodeHash: Bytes32;
  readonly deploymentTransactionHash: Bytes32;
  readonly deploymentBlockNumber: number;
  readonly observedAtBlock: bigint;
}

export interface ProtocolTransitionProjection {
  readonly chainId: number;
  readonly domain: ProtocolEventDomain;
  readonly subjectId: Bytes32;
  readonly eventName: string;
  readonly payload: JsonObject;
  readonly transactionHash: Bytes32;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly blockNumber: bigint;
}

export interface ProtocolSubjectProjection {
  readonly chainId: number;
  readonly domain: ProtocolEventDomain;
  readonly subjectId: Bytes32;
  readonly latestEventName: string;
  readonly latestPayload: JsonObject;
  readonly transitionCount: number;
  readonly updatedAtBlock: bigint;
}

export interface ProjectionState {
  readonly processedLogIds: Set<string>;
  readonly registryVersions: Map<string, RegistryVersionProjection>;
  readonly registryHeads: Map<string, RegistryHeadProjection>;
  readonly accounts: Map<string, CollateralAccountProjection>;
  readonly lockOperators: Map<string, LockOperatorProjection>;
  readonly balances: Map<string, CollateralBalanceProjection>;
  readonly locks: Map<string, CollateralLockProjection>;
  readonly terminalReservations: Map<string, TerminalReservationProjection>;
  readonly terminalClaims: Map<string, TerminalClaimProjection>;
  readonly excessRecoveries: Map<string, ExcessRecoveryProjection>;
  readonly deployments: Map<string, DeploymentProjection>;
  readonly protocolTransitions: Map<string, ProtocolTransitionProjection>;
  readonly protocolSubjects: Map<string, ProtocolSubjectProjection>;
}

export function emptyProjectionState(): ProjectionState {
  return {
    processedLogIds: new Set(),
    registryVersions: new Map(),
    registryHeads: new Map(),
    accounts: new Map(),
    lockOperators: new Map(),
    balances: new Map(),
    locks: new Map(),
    terminalReservations: new Map(),
    terminalClaims: new Map(),
    excessRecoveries: new Map(),
    deployments: new Map(),
    protocolTransitions: new Map(),
    protocolSubjects: new Map(),
  };
}
