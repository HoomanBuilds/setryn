# Setryn settlement asset qualification

## Purpose

`SettlementAssetRegistry` is the chain-local operational layer that connects a canonical Setryn
`AssetId` to a real ERC-20 contract on the chain the protocol is deployed to. It exists so that no
vault, collateral module, or settlement path ever has to guess which token address an identity means,
and so that the decision to accept a token is an explicit, reviewed, versioned, and revocable act.

## Boundary against AssetRegistry

`AssetRegistry` is the immutable, chain-portable identity source. An `AssetDefinition` carries only
facts that are true on every chain: namespace, reference, symbol, class, and decimals semantics.

Token address, chain id, runtime code hash, and qualification evidence are deployment-specific. They
never enter `AssetDefinition`. Adding any of them there would split one canonical asset into a
different identity per chain and break every cross-deployment comparison the protocol depends on.

`SettlementAssetRegistry` holds no funds. It never calls `transfer`, `transferFrom`, or `approve`, it
never uses `delegatecall`, and it makes exactly two kinds of external read: the canonical registry,
and `IERC20Metadata.decimals()` on the token under qualification.

## Versioned definition

```solidity
struct SettlementAssetDefinition {
    AssetId assetId;
    address token;
    bytes32 expectedRuntimeCodeHash;
    bytes32 qualificationHash;
}
```

Each accepted definition becomes an immutable version. Versions are sequential `uint32` values per
`AssetId` starting at 1, so 0 is an unambiguous no-such-version sentinel for both the latest pointer
and the active pointer. Every historical version stays queryable forever; nothing is ever deleted or
edited.

Two commitments are stored per version:

- `definitionHash` commits the chain-local definition under the explicit V1 typehash
  `SetrynSettlementAssetDefinitionV1(bytes32 assetId,address token,bytes32 expectedRuntimeCodeHash,bytes32 qualificationHash,uint256 chainId)`.
  `chainId` is hashed in deliberately, the opposite of canonical identity derivation, because the same
  token address on two chains is two different contracts and the two qualifications must never share
  one commitment.
- `versionHash` commits `definitionHash`, the sequence number, and the canonical decimals snapshot
  under `SetrynSettlementAssetVersionV1(bytes32 definitionHash,uint32 version,uint8 decimals)`, so a
  stored record can never be replayed as a different version of itself.

An identical `definitionHash` may not be registered twice for the same `AssetId`. Registering the
same token again under a new `qualificationHash`, or on a different chain, is a genuinely new
qualification and therefore a new version.

`decimals` is the canonical asset decimals snapshot taken from `AssetRegistry` at registration and
verified against the token at that moment. Later reads compare against the snapshot rather than
re-trusting the token.

## Qualification checks

Registration performs every check before any storage mutation, in this order:

1. The `AssetId` exists in `IAssetRegistry`, otherwise `UnknownCanonicalAsset`.
2. Canonical decimals are at most `MAX_DECIMALS`, otherwise `CanonicalDecimalsOutOfRange`.
3. `token` is nonzero (`ZeroSettlementToken`) and has code (`SettlementTokenHasNoCode`).
4. `expectedRuntimeCodeHash` is nonzero (`ZeroRuntimeCodeHash`) and equals `token.codehash`
   (`RuntimeCodeHashMismatch`).
5. `qualificationHash` is nonzero (`ZeroQualificationHash`).
6. `IERC20Metadata(token).decimals()` returns successfully (`TokenDecimalsUnavailable`), returns a
   value that fits in `uint8` (`TokenDecimalsMalformed`), and equals the canonical decimals
   (`TokenDecimalsMismatch`).
7. The token is not already bound to a different `AssetId` (`TokenBoundToDifferentAsset`). A token may
   appear in any number of later versions of the same `AssetId`.
8. The definition is not a duplicate (`DuplicateSettlementDefinition`).

No token address is hardcoded. No chain-specific branch exists anywhere in the contract.

## State model

Registration creates the version in `Paused`, so the party that proposes a binding is never the party
that switches it on. Permitted transitions:

- `Paused -> Active`
- `Active -> Paused`
- `Active -> Deprecated`
- `Paused -> Deprecated`

`Deprecated` is terminal. There is no delete path.

At most one version per `AssetId` is the active version. Activation additionally fails if another
version is already active (`AnotherVersionActive`), the canonical asset is not `Active`
(`CanonicalAssetNotActive`), the runtime code hash no longer matches, or the live decimals no longer
match the snapshot. Activation is therefore a full re-verification against live chain state, because
the token may have been upgraded or replaced since the version was written.

Activating a new version never silently pauses the old one. An operator must explicitly pause or
deprecate the current active version first. Pausing or deprecating the active version clears the
active pointer and emits `SettlementAssetActiveVersionChanged` with a new version of 0.

## New risk versus lifecycle

These are deliberately different questions and must never be collapsed into one flag.

- `isOpenForNewRisk(assetId, version)` is true only when the version is the active pointer, its status
  is `Active`, the canonical asset is `Active`, the token still has code, and both the runtime code
  hash and the live decimals still match the stored version. This is the only gate a consumer may use
  to accept new collateral or open new risk.
- `isLifecycleEnabled(assetId, version)` is true for any registered version, including `Paused` and
  `Deprecated` ones. It means the binding resolves historically. It does not promise that a transfer
  will succeed.
- `runtimeMatches(assetId, version)` is a non-reverting boolean for operational monitoring. It answers
  only whether the token still carries the qualified runtime bytecode and still reports the
  snapshotted decimals.

**A vault must never require `Active` status to withdraw an already credited balance.** If withdrawal
depended on the new-risk gate, pausing an asset would strand user funds. Pausing must stop inflow, not
outflow. Withdrawal and other lifecycle operations resolve the binding through
`isLifecycleEnabled` and the historical version record.

## Events and views

Events are the enumeration source; the registry keeps no enumerable onchain arrays.

- `SettlementAssetRegistered(assetId, version, versionHash, definitionHash, token, expectedRuntimeCodeHash, decimals, qualificationHash, chainId, operator)`
- `SettlementAssetStatusChanged(assetId, version, previousStatus, newStatus, operator)`
- `SettlementAssetActiveVersionChanged(assetId, previousVersion, newVersion, operator)`

Together these let an indexer reconstruct every version and every transition from logs alone.

Views: `getBinding`, `latestVersion`, `activeVersion`, `statusOf`, `bindingCount`, `tokenAsset`,
`runtimeMatches`, `isOpenForNewRisk`, `isLifecycleEnabled`, and `assetRegistry`.

`getBinding` reverts with `UnknownBinding` for an unregistered asset or version. The boolean and
pointer views return `false` or 0 instead, so monitoring never has to catch a revert.

## Roles

`AccessControlDefaultAdminRules`, matching `AssetRegistry`.

- `QUALIFIER_ROLE` registers immutable versions.
- `STATUS_MANAGER_ROLE` activates, pauses, and deprecates.

The constructor takes `defaultAdminDelay`, a nonzero `initialAdmin`, and a nonzero deployed
`IAssetRegistry` (checked for both a zero address and empty code). It grants both operational roles to
`initialAdmin`. In any deployment beyond a single-operator bootstrap they are expected to be granted
to different parties: holding `QUALIFIER_ROLE` alone gives no ability to activate anything.

There is no upgrade proxy in this slice.

## Known limitation: code hash attests the proxy, not the implementation

`expectedRuntimeCodeHash` attests the runtime bytecode found at `token`. For a proxy, that is the
proxy bytecode only. An upgradeable token can change its implementation, and therefore its entire
behavior, without changing its runtime code hash. `runtimeMatches` would still report true.

The code hash is therefore a cheap onchain tripwire against address substitution and redeployment, not
a behavioral guarantee. `qualificationHash` carries the weight: it is the commitment to the broader
offchain review evidence, which must cover the implementation bytecode, the upgrade authority, the
pause and blocklist authorities, fee-on-transfer and rebasing behavior, and the operational
assumptions the qualification was granted under. Any change to that evidence is a new version, not an
edit.

Detecting an implementation change behind a proxy is out of scope for this slice and belongs to the
offchain monitoring layer that consumes these events.
