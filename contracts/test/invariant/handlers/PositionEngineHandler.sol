// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PositionEngine} from "../../../src/position/PositionEngine.sol";
import {AccountId, PositionId, SeriesId} from "../../../src/types/Identifiers.sol";
import {PositionCreation, PositionStatus} from "../../../src/types/PositionTypes.sol";
import {Lots, PriceTicks} from "../../../src/types/Units.sol";

contract PositionEngineHandler {
    uint256 private constant MAX_POSITIONS = 32;

    PositionEngine private immutable _engine;
    SeriesId private immutable _seriesId;
    AccountId private immutable _longAccountId;
    AccountId private immutable _shortAccountId;
    bytes private _terms;
    PositionId[] private _positions;

    constructor(
        PositionEngine engine_,
        SeriesId seriesId_,
        AccountId longAccountId_,
        AccountId shortAccountId_,
        bytes memory terms_
    ) {
        _engine = engine_;
        _seriesId = seriesId_;
        _longAccountId = longAccountId_;
        _shortAccountId = shortAccountId_;
        _terms = terms_;
    }

    function create(uint128 rawLots) external {
        if (_positions.length >= MAX_POSITIONS) return;
        uint128 lots = uint128((uint256(rawLots) % 100) + 1);
        uint32 ordinal = uint32(_positions.length);
        PositionCreation memory creation = PositionCreation({
            fillIdentity: keccak256(abi.encode("invariant.fill", ordinal)),
            seriesId: _seriesId,
            seriesVersion: 1,
            longAccountId: _longAccountId,
            shortAccountId: _shortAccountId,
            ordinal: ordinal,
            lots: Lots.wrap(lots),
            entryPriceTicks: PriceTicks.wrap(int128(uint128(lots))),
            payoffTerms: _terms
        });
        _positions.push(_engine.createPosition(creation));
    }

    function close(uint256 seed) external {
        uint256 length = _positions.length;
        if (length == 0) return;
        PositionId positionId = _positions[seed % length];
        if (_engine.positionStatus(positionId) != PositionStatus.Live) return;
        _engine.recordZeroLiabilityAlternative(
            positionId, PositionStatus.ClosedByUnwind, keccak256(abi.encode("invariant.close", seed))
        );
    }

    function positionCount() external view returns (uint256) {
        return _positions.length;
    }

    function positionAt(uint256 index) external view returns (PositionId) {
        return _positions[index];
    }
}
