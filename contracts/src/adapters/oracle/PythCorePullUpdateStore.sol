// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Exact Pyth Core price struct matching the official Pyth EVM API.
struct Price {
    int64 price;
    uint64 conf;
    int32 expo;
    uint256 publishTime;
}

/// @notice Exact Pyth Core price-feed struct matching the official Pyth EVM API.
struct PriceFeed {
    bytes32 id;
    Price price;
    Price emaPrice;
}

/// @notice Minimal Pyth Core receiver surface required for pull verification.
interface IPythCoreReceiver {
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 feeAmount);
    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PriceFeed[] memory priceFeeds);
    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (Price memory price);
}

/// @notice Immutable content-addressed record of one verified Pyth pull update.
struct PythVerifiedRecord {
    int64 price;
    uint64 conf;
    int32 expo;
    uint64 publishTime;
    uint64 minPublishTime;
    uint64 maxPublishTime;
    bytes32 updateHash;
}

/// @notice Permissionless Pyth Core pull update store bound to one chain and one receiver.
/// @dev Accepts exactly one feed ID plus an exact Hermes window and updateData, requires
///      msg.value to equal the receiver-quoted fee exactly, forwards that fee with the
///      parsePriceFeedUpdatesUnique call, validates exactly one matching feed with a positive
///      price and a nonzero bounded publish time inside the requested window, plus confidence
///      and exponent bounds, then stores the record keyed by feed ID plus publish time.
///      Conflicting rewrites revert; exact replays succeed idempotently. Emits full
///      reconstruction evidence on every success. Retains no ETH and refunds nothing.
contract PythCorePullUpdateStore is ReentrancyGuard {
    uint256 public immutable expectedChainId;
    IPythCoreReceiver public immutable pythReceiver;

    int32 public constant MIN_EXPO = -36;
    int32 public constant MAX_EXPO = 36;
    uint64 public constant MAX_CONF = 9_223_372_036_854_775_807;

    mapping(bytes32 feedId => mapping(uint64 publishTime => PythVerifiedRecord record)) internal _records;

    event PythPullVerified(
        bytes32 indexed feedId,
        uint64 indexed publishTime,
        IPythCoreReceiver indexed receiver,
        int64 price,
        uint64 conf,
        int32 expo,
        uint64 minPublishTime,
        uint64 maxPublishTime,
        bytes32 updateHash,
        uint256 chainId,
        uint256 fee
    );

    error WrongDeploymentChain(uint256 expectedChainId, uint256 actualChainId);
    error ZeroReceiver();
    error ReceiverWithoutCode(address receiver);
    error ZeroFeedId();
    error EmptyUpdateData();
    error ZeroMaxPublishTime();
    error InvertedWindow(uint64 minPublishTime, uint64 maxPublishTime);
    error FeeMismatch(uint256 expectedFee, uint256 actualValue);
    error WrongFeedCount(uint256 actual);
    error FeedIdMismatch(bytes32 expected, bytes32 actual);
    error NonPositivePrice(int64 price);
    error ZeroPublishTime();
    error PublishTimeOverflow(uint256 publishTime);
    error PublishTimeBelowWindow(uint256 publishTime, uint64 minPublishTime, uint64 maxPublishTime);
    error PublishTimeAboveWindow(uint256 publishTime, uint64 minPublishTime, uint64 maxPublishTime);
    error FuturePublishTime(uint256 publishTime, uint256 timestamp);
    error ExpoOutOfBounds(int32 expo);
    error ConfidenceOutOfBounds(uint64 conf, uint64 maximum);
    error ConflictingRecord(bytes32 feedId, uint64 publishTime);

    constructor(uint256 expectedChainId_, address receiver_) {
        if (expectedChainId_ == 0 || expectedChainId_ != block.chainid) {
            revert WrongDeploymentChain(expectedChainId_, block.chainid);
        }
        if (receiver_ == address(0)) revert ZeroReceiver();
        if (receiver_.code.length == 0) revert ReceiverWithoutCode(receiver_);
        expectedChainId = expectedChainId_;
        pythReceiver = IPythCoreReceiver(receiver_);
    }

    /// @notice Verify one Hermes pull update and store its immutable record.
    function pullAndVerify(bytes32 feedId, uint64 minPublishTime, uint64 maxPublishTime, bytes[] calldata updateData)
        external
        payable
        nonReentrant
        returns (PythVerifiedRecord memory record)
    {
        if (block.chainid != expectedChainId) revert WrongDeploymentChain(expectedChainId, block.chainid);
        if (feedId == bytes32(0)) revert ZeroFeedId();
        if (updateData.length == 0) revert EmptyUpdateData();
        if (maxPublishTime == 0) revert ZeroMaxPublishTime();
        if (minPublishTime > maxPublishTime) revert InvertedWindow(minPublishTime, maxPublishTime);

        uint256 fee = pythReceiver.getUpdateFee(updateData);
        if (msg.value != fee) revert FeeMismatch(fee, msg.value);

        bytes32[] memory priceIds = new bytes32[](1);
        priceIds[0] = feedId;
        PriceFeed[] memory feeds =
            pythReceiver.parsePriceFeedUpdatesUnique{value: fee}(updateData, priceIds, minPublishTime, maxPublishTime);
        if (feeds.length != 1) revert WrongFeedCount(feeds.length);
        if (feeds[0].id != feedId) revert FeedIdMismatch(feedId, feeds[0].id);

        Price memory parsed = feeds[0].price;
        if (parsed.price <= 0) revert NonPositivePrice(parsed.price);
        if (parsed.publishTime == 0) revert ZeroPublishTime();
        if (parsed.publishTime > type(uint64).max) revert PublishTimeOverflow(parsed.publishTime);
        if (parsed.publishTime < minPublishTime) {
            revert PublishTimeBelowWindow(parsed.publishTime, minPublishTime, maxPublishTime);
        }
        if (parsed.publishTime > maxPublishTime) {
            revert PublishTimeAboveWindow(parsed.publishTime, minPublishTime, maxPublishTime);
        }
        if (parsed.publishTime > block.timestamp) revert FuturePublishTime(parsed.publishTime, block.timestamp);
        if (parsed.expo < MIN_EXPO || parsed.expo > MAX_EXPO) revert ExpoOutOfBounds(parsed.expo);
        if (parsed.conf > MAX_CONF) revert ConfidenceOutOfBounds(parsed.conf, MAX_CONF);

        uint64 publishTime = uint64(parsed.publishTime);
        bytes32 updateHash = keccak256(abi.encode(updateData, feedId, minPublishTime, maxPublishTime));

        PythVerifiedRecord storage existing = _records[feedId][publishTime];
        if (existing.publishTime != 0) {
            if (
                existing.price != parsed.price || existing.conf != parsed.conf || existing.expo != parsed.expo
                    || existing.minPublishTime != minPublishTime || existing.maxPublishTime != maxPublishTime
                    || existing.updateHash != updateHash
            ) {
                revert ConflictingRecord(feedId, publishTime);
            }
            record = existing;
        } else {
            record = PythVerifiedRecord({
                price: parsed.price,
                conf: parsed.conf,
                expo: parsed.expo,
                publishTime: publishTime,
                minPublishTime: minPublishTime,
                maxPublishTime: maxPublishTime,
                updateHash: updateHash
            });
            _records[feedId][publishTime] = record;
        }

        emit PythPullVerified(
            feedId,
            publishTime,
            pythReceiver,
            record.price,
            record.conf,
            record.expo,
            record.minPublishTime,
            record.maxPublishTime,
            record.updateHash,
            expectedChainId,
            fee
        );
    }

    /// @notice Read one verified record; reverts nothing, returns zero record when absent.
    function getRecord(bytes32 feedId, uint64 publishTime) external view returns (PythVerifiedRecord memory) {
        return _records[feedId][publishTime];
    }
}
