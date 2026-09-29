# Setryn adapter registry

## Purpose

`AdapterRegistry` is the chain-local layer that qualifies which deployed implementation stands behind
a stable, chain-portable Setryn `AdapterId`. It exists so that no benchmark, venue, settlement,
delivery, curve, risk, or privacy consumer ever has to name a vendor, hardcode an address, or import a
concrete implementation type, and so that accepting an implementation is an explicit, reviewed,
versioned, and revocable act.

Core modules depend on `IAdapterRegistry` plus an `AdapterId` and a version. They never depend on a
vendor name or an implementation contract type.

## Security boundary

The registry holds no funds, grants no approvals, and never calls, staticcalls, delegatecalls, or
interface-probes an implementation. Its only introspection of an implementation is `extcodesize` and
`extcodehash`. No adapter can execute in the registry's context or reenter it.

Qualifying an adapter is not running one. Calling an adapter is the job of the consuming module, which
must require the exact kind and capability commitment it supports and fail closed on everything else.

There is no vendor list, no address constant, no network branch, no RPC, and no deployment behavior in
this contract.

### What a runtime code hash does and does not attest

`expectedRuntimeCodeHash` attests the bytecode **at the implementation address**. Behind a proxy that
is the proxy bytecode alone, and a proxy's bytecode does not change when the implementation it points
at is swapped.

`evidenceHash` is therefore required to cover the broader review, and must commit at least:

- the implementation address behind the proxy and the proxy's implementation slot;
- the upgrade authority and the process that governs it;
- admin controls, pausers, and any privileged role on the implementation;
- external dependencies the implementation reads or calls;
- the configuration the implementation was reviewed with.

Detecting a swapped implementation behind an unchanged proxy is the job of a future monitor. This
contract deliberately does not attempt it, because doing so would require calling the proxy.

## Versioned definition

```solidity
struct AdapterDefinition {
    bytes32 namespaceId;
    bytes32 referenceId;
    AdapterKindId kindId;
    address implementation;
    bytes32 expectedRuntimeCodeHash;
    bytes32 interfaceHash;
    bytes32 capabilityHash;
    bytes32 configurationSchemaHash;
    bytes32 evidenceHash;
}
```

Each accepted definition becomes an immutable chain-local `AdapterVersion` carrying the definition,
`definitionHash`, `versionHash`, a sequential `uint32 version`, and a `RegistryStatus`. Versions start
at 1 per `AdapterId`, so 0 is an unambiguous no-such-version sentinel for both the latest pointer and
the active pointer. Every historical version stays queryable forever; nothing is ever deleted or
edited in place.

The four commitment hashes are evidence anchors, never computation inputs:

- `interfaceHash` commits the exact interface IDs and ABI revision the implementation was qualified
  against, so an ABI change is a new version rather than a silent reinterpretation;
- `capabilityHash` commits the supported operations and their stated limitations;
- `configurationSchemaHash` commits the shape of the configuration that was validated;
- `evidenceHash` commits the broader review record described above.

## Identity and commitments

- `AdapterId` is derived through `IdLib.deriveAdapterId` from the V1 key
  `SetrynAdapterKeyV1(bytes32 namespaceId,bytes32 referenceId,bytes32 kindId)`. The key commits those
  three fields **only**, so one logical adapter keeps one identity across chains and across every
  implementation revision. `kindId` is part of the key because an adapter that changes capability
  category is a different logical adapter, not a new version of the old one.
- `definitionHash` commits every definition field **plus `block.chainid`** under
  `SetrynAdapterDefinitionV1(...,uint256 chainId)`. This is the opposite of canonical identity
  derivation and is deliberate: the same implementation address on two chains is two different
  contracts, and the two qualifications must never share one commitment.
- `versionHash` commits `adapterId`, `version`, `definitionHash`, and `chainId` under
  `SetrynAdapterVersionV1(bytes32 adapterId,uint32 version,bytes32 definitionHash,uint256 chainId)`, so
  a stored record can never be replayed as a different version of itself, as a version of a different
  adapter, or as the same version on another chain.

An identical `definitionHash` may not be registered twice for the same `AdapterId`. Re-qualifying the
same implementation under a new `interfaceHash`, `capabilityHash`, `configurationSchemaHash`, or
`evidenceHash`, or on a different chain, is a genuinely new qualification and therefore a new version.
Exhausting the `uint32` version space is the named error `AdapterVersionExhausted` rather than an
arithmetic panic.

## Adapter kinds are open

`AdapterKindId` is an open typed `bytes32` capability category, never a Solidity enum. A closed enum
would force a redeployment for every new adapter category and would make ordinals load-bearing.

`AdapterDefinitionLib` publishes convenience constants for the categories V1 consumers meet first:
Benchmark, Venue, Settlement, Delivery, Curve, Risk, Privacy. They are conveniences only. Registration
and hashing accept **any nonzero** `AdapterKindId`, so a category invented after this deployment needs
no change to this code.

A consumer must require the exact `kindId`, `interfaceHash`, and `capabilityHash` it supports, and fail
closed on every other combination. The registry does not, and cannot, decide that for it:
`isOpenForNewRisk` says a version is live, never that it fits the caller.

## Validation

Registration performs every check before any storage mutation:

1. `namespaceId`, `referenceId`, `kindId`, `expectedRuntimeCodeHash`, `interfaceHash`,
   `capabilityHash`, `configurationSchemaHash`, and `evidenceHash` are all nonzero.
2. `implementation` is nonzero (`ZeroAdapterImplementation`) and currently holds code
   (`AdapterImplementationHasNoCode`).
3. `implementation.codehash` equals `expectedRuntimeCodeHash`, otherwise
   `AdapterRuntimeCodeHashMismatch(implementation, expected, actual)`.

The no-code case is named separately from the mismatch case, even though a codeless account also fails
the hash comparison, because "never deployed or self-destructed" and "deployed but not the reviewed
bytecode" are different operational findings.

Implementation address uniqueness is deliberately **not** enforced. One multi-capability deployment may
legitimately back several `AdapterId` lineages and several kinds at once.

## State model

- Registration lands in `Paused`. The qualifier who proposes an implementation is never the party that
  opens new risk against it.
- Transitions: `Paused -> Active`, `Active -> Paused`, `Active | Paused -> Deprecated`. `Deprecated` is
  terminal. Nothing is ever deleted.
- At most one `Active` version per `AdapterId`. Activating a second one reverts
  `AnotherAdapterVersionActive`; it never silently pauses the incumbent. Pausing or deprecating the
  active version clears the pointer to 0 and emits the change.
- Two roles: `ADAPTER_QUALIFIER_ROLE` registers versions, `ADAPTER_STATUS_MANAGER_ROLE` activates,
  pauses, and deprecates. The constructor requires a nonzero `initialAdmin` and grants both operational
  roles to it, on top of `AccessControlDefaultAdminRules`.

### Activation is the drift gate

`activateAdapter` revalidates that the implementation still holds code and that its runtime code hash
still equals the qualified one, because the address may have been destroyed or redeployed since the
version was written. It fails closed with the same named errors as registration and leaves the version
exactly as it was.

Registration and codehash validity are evidence, never authorization. Qualification and activation are
separate, fail-closed gates.

## New risk against lifecycle

- `isOpenForNewRisk(adapterId, version)` is the only gate a consumer may use to route new risk. It
  requires **all** of: the version is the active pointer, its status is `Active`, and the live runtime
  code hash still matches. Bytecode drift at the implementation address closes new risk immediately,
  with no transaction and no status change.
- `isLifecycleEnabled(adapterId, version)` is true for **every** registered version, including Paused
  and Deprecated ones, and regardless of the current runtime code hash. Settlement, fixing, unwind,
  receipt replay, and audit of positions opened through a retired adapter must never require current
  Active status.
- `runtimeMatches(adapterId, version)` is monitoring only. It is never permission and it proves nothing
  about the implementation behind a proxy.

## Unknown records

`getAdapter`, `activateAdapter`, `pauseAdapter`, and `deprecateAdapter` revert
`UnknownAdapterVersion(adapterId, version)`. A mutation must never treat an absent record as a Paused
one and quietly create it, and `getAdapter` must not return a zeroed struct that names the zero
implementation.

Monitoring, pointer, and boolean views use explicit sentinels instead: `statusOf` answers
`RegistryStatus.Unspecified` (never a reachable stored state), `latestVersion` and `activeVersion`
answer 0 (versions start at 1), and `exists`, `runtimeMatches`, `isOpenForNewRisk`, and
`isLifecycleEnabled` answer `false`.

## Events

Enumerability comes from logs, not from onchain arrays.

- `AdapterRegistered(adapterId, version, versionHash, definitionHash, definition, chainId, initialStatus, operator)`
  carries the whole `AdapterDefinition` tuple, so an indexer can rebuild every version from logs alone.
  The definition rides as a tuple rather than nine flattened parameters because flattening exhausts the
  EVM stack at the emit site; the ABI encoding carries the same nine fields either way. `chainId` is
  logged because qualification is chain-local, and `initialStatus` is logged rather than assumed.
- `AdapterStatusChanged(adapterId, version, previousStatus, newStatus, operator)`.
- `AdapterActiveVersionChanged(adapterId, previousVersion, newVersion, operator)`, including when the
  pointer is cleared to 0.

## Offchain responsibilities

The qualifier of an adapter must, before registration:

1. Deploy or identify the implementation and record its exact runtime code hash on the target chain.
2. Review the implementation behind any proxy, its upgrade authority, its admin controls, its external
   dependencies, and its configuration, and publish that record as `evidenceHash`.
3. Pin the interface IDs and ABI revision as `interfaceHash`, the supported operations and their
   limitations as `capabilityHash`, and the validated configuration shape as
   `configurationSchemaHash`.
4. Namespace the `AdapterKindId` it is claiming, and publish what a consumer must support to accept it.

## Extensibility proof

1. `AdapterId` is a stable, chain-portable lineage ID derived from a V1 key containing only
   `namespaceId`, `referenceId`, and `kindId`. No implementation revision, commitment revision, or
   chain can split or merge a lineage.
2. `AdapterKindId` is an open typed `bytes32`, not a closed enum. Registration and hashing accept any
   nonzero value; the published Benchmark, Venue, Settlement, Delivery, Curve, Risk, and Privacy
   constants are convenience only. A kind invented after this deployment needs no change here.
3. New implementations enter as append-only immutable chain-local versions under the stable
   `AdapterId`. Nothing is ever overwritten or deleted, and adding an adapter requires redeploying no
   other module.
4. Core modules reach adapters through `IAdapterRegistry` plus `AdapterId` and version, never through a
   vendor name, an address constant, or a concrete implementation type.
5. Registration never grants risk authority. Qualification (field validation and live bytecode proof)
   and a separately-roled activation (fresh bytecode revalidation) are both required, and both fail
   closed.
6. Unsupported kind and capability combinations fail closed in consumers, which must require the exact
   `kindId`, `interfaceHash`, and `capabilityHash` they support.
7. Historical versions remain resolvable through `getAdapter` and `isLifecycleEnabled` after pause,
   after deprecation, and after the bytecode at the implementation address has drifted.

## Files

- `contracts/src/types/Identifiers.sol` (adds `AdapterKindId`)
- `contracts/src/types/AdapterDefinition.sol`
- `contracts/src/libraries/AdapterDefinitionLib.sol`
- `contracts/src/interfaces/IAdapterRegistry.sol`
- `contracts/src/registry/AdapterRegistry.sol`
- `contracts/test/unit/AdapterRegistry.t.sol`
- `contracts/test/fuzz/AdapterRegistry.fuzz.t.sol`
