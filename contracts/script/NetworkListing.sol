// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Vm} from "forge-std/Vm.sol";

/// @notice The network market listing (`deployments/<network>/markets.json`, schema 2) as the network bootstrap reads it.
/// `scripts/generate-network-markets.mjs` writes it from live Chainlink references on Arbitrum One; this library parses
/// it and refuses anything the bootstrap could not register exactly: wrong schema, wrong network, a payoff band that is
/// not the exact product of the lot and the floor-to-cap range, an expiry that is not 08:00 UTC, or a series that can no
/// longer trade.
library NetworkListing {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant SCHEMA_VERSION = 2;
    uint8 internal constant FIXING_DECIMALS = 8;
    uint256 internal constant REFERENCE_CHAIN_ID = 42_161;
    uint256 internal constant PAYOFF_MULTIPLIER_DENOMINATOR = 1e8;
    uint64 internal constant EXPIRY_AFTER_MIDNIGHT = 8 hours;
    uint64 internal constant LAST_TRADING_BEFORE_EXPIRY = 2 hours;
    uint256 internal constant MAXIMUM_FAMILIES = 32;
    uint256 internal constant MAXIMUM_MARKETS = 64;

    error InvalidMarketListing(string field, string reason);

    /// One underlying: a base asset and the settlement fixing benchmark its series fix on.
    struct Family {
        string symbol;
        string underlying;
        string feedKey;
        uint8 assetClass;
        /// Chainlink aggregator proxy on Arbitrum One that references the underlying.
        address referenceFeed;
        string strategyKind;
    }

    /// One dated range forward. Decimal strings are carried through to the runtime unchanged.
    struct Market {
        string marketKey;
        uint256 family;
        string displayName;
        uint64 expiryAt;
        uint256 floorE8;
        uint256 capE8;
        string floor;
        string cap;
        string lotSize;
        string tickPrice;
        uint8 priceDecimals;
        uint64 priceScale;
        uint128 tickSizeMinor;
        uint256 payoffMultiplierNumerator;
        uint256 payoffMultiplierDenominator;
        uint128 bandMinor;
        uint128 maxOrderLots;
    }

    struct Listing {
        string network;
        uint64 listedAt;
        Family[] families;
        Market[] markets;
    }

    function read(string memory json) internal view returns (Listing memory listing) {
        if (vm.parseJsonUint(json, ".schemaVersion") != SCHEMA_VERSION) {
            revert InvalidMarketListing("schemaVersion", "");
        }
        if (vm.parseJsonUint(json, ".fixingDecimals") != FIXING_DECIMALS) {
            revert InvalidMarketListing("fixingDecimals", "the benchmarks fix with 8 decimals");
        }
        if (vm.parseJsonUint(json, ".reference.chainId") != REFERENCE_CHAIN_ID) {
            revert InvalidMarketListing("reference.chainId", "references are Chainlink feeds on Arbitrum One");
        }
        listing.network = vm.parseJsonString(json, ".network");
        listing.listedAt = uint64(vm.parseJsonUint(json, ".listedAt"));
        listing.families = new Family[](_count(json, ".families", MAXIMUM_FAMILIES));
        listing.markets = new Market[](_count(json, ".markets", MAXIMUM_MARKETS));
        for (uint256 i; i < listing.families.length; ++i) {
            listing.families[i] = _family(json, string.concat(".families[", vm.toString(i), "]"));
        }
        for (uint256 i; i < listing.markets.length; ++i) {
            listing.markets[i] = _market(json, string.concat(".markets[", vm.toString(i), "]"));
        }
    }

    /// Refuses a listing the bootstrap cannot register exactly on this chain at `nowTs`.
    function validate(Listing memory listing, string memory expectedNetwork, uint256 nowTs) internal pure {
        if (keccak256(bytes(listing.network)) != keccak256(bytes(expectedNetwork))) {
            revert InvalidMarketListing("network", string.concat("this chain lists ", expectedNetwork));
        }
        if (listing.listedAt == 0) revert InvalidMarketListing("listedAt", "zero");
        if (listing.families.length == 0 || listing.markets.length == 0) {
            revert InvalidMarketListing("markets", "empty");
        }
        for (uint256 i; i < listing.families.length; ++i) {
            Family memory family = listing.families[i];
            if (bytes(family.symbol).length == 0 || bytes(family.symbol).length > 32) {
                revert InvalidMarketListing(family.symbol, "family symbol must be 1 to 32 bytes");
            }
            if (bytes(family.feedKey).length == 0 || family.referenceFeed == address(0) || family.assetClass == 0) {
                revert InvalidMarketListing(family.symbol, "family feed");
            }
            for (uint256 j; j < i; ++j) {
                if (keccak256(bytes(listing.families[j].symbol)) == keccak256(bytes(family.symbol))) {
                    revert InvalidMarketListing(family.symbol, "duplicate family");
                }
            }
        }
        for (uint256 i; i < listing.markets.length; ++i) {
            Market memory market = listing.markets[i];
            string memory key = market.marketKey;
            if (bytes(key).length == 0) revert InvalidMarketListing("marketKey", "empty");
            for (uint256 j; j < i; ++j) {
                if (keccak256(bytes(listing.markets[j].marketKey)) == keccak256(bytes(key))) {
                    revert InvalidMarketListing(key, "duplicate market");
                }
            }
            if (market.family >= listing.families.length) revert InvalidMarketListing(key, "unknown family");
            if (market.expiryAt % 1 days != EXPIRY_AFTER_MIDNIGHT) {
                revert InvalidMarketListing(key, "expiry is not 08:00 UTC");
            }
            if (market.expiryAt - LAST_TRADING_BEFORE_EXPIRY <= nowTs) {
                revert InvalidMarketListing(key, "last trading time has passed; regenerate the listing");
            }
            if (listing.listedAt >= market.expiryAt - LAST_TRADING_BEFORE_EXPIRY) {
                revert InvalidMarketListing(key, "listed after its last trading time");
            }
            if (market.floorE8 == 0 || market.capE8 <= market.floorE8 || market.capE8 > uint256(type(int256).max)) {
                revert InvalidMarketListing(key, "floor and cap");
            }
            if (
                market.payoffMultiplierNumerator == 0
                    || market.payoffMultiplierDenominator != PAYOFF_MULTIPLIER_DENOMINATOR
            ) revert InvalidMarketListing(key, "payoff multiplier");
            // The band is the payoff at the cap: lot x (cap - floor), exact in settlement minor units.
            if (
                (market.capE8 - market.floorE8) * market.payoffMultiplierNumerator
                        != uint256(market.bandMinor) * market.payoffMultiplierDenominator || market.bandMinor == 0
            ) revert InvalidMarketListing(key, "band is not lot x (cap - floor)");
            if (market.tickSizeMinor == 0 || market.bandMinor % market.tickSizeMinor != 0) {
                revert InvalidMarketListing(key, "the band is not a whole number of ticks");
            }
            if (market.priceScale == 0 || market.maxOrderLots == 0) revert InvalidMarketListing(key, "price grid");
        }
    }

    function _family(string memory json, string memory path) private pure returns (Family memory family) {
        family = Family({
            symbol: vm.parseJsonString(json, string.concat(path, ".symbol")),
            underlying: vm.parseJsonString(json, string.concat(path, ".underlying")),
            feedKey: vm.parseJsonString(json, string.concat(path, ".feedKey")),
            assetClass: uint8(vm.parseJsonUint(json, string.concat(path, ".assetClass"))),
            referenceFeed: vm.parseJsonAddress(json, string.concat(path, ".referenceFeed")),
            strategyKind: vm.parseJsonString(json, string.concat(path, ".strategyKind"))
        });
    }

    function _market(string memory json, string memory path) private pure returns (Market memory market) {
        market.marketKey = vm.parseJsonString(json, string.concat(path, ".marketKey"));
        market.family = vm.parseJsonUint(json, string.concat(path, ".family"));
        market.displayName = vm.parseJsonString(json, string.concat(path, ".displayName"));
        market.expiryAt = uint64(vm.parseJsonUint(json, string.concat(path, ".expiryAt")));
        market.floorE8 = vm.parseJsonUint(json, string.concat(path, ".floorE8"));
        market.capE8 = vm.parseJsonUint(json, string.concat(path, ".capE8"));
        market.floor = vm.parseJsonString(json, string.concat(path, ".floor"));
        market.cap = vm.parseJsonString(json, string.concat(path, ".cap"));
        market.lotSize = vm.parseJsonString(json, string.concat(path, ".lotSize"));
        market.tickPrice = vm.parseJsonString(json, string.concat(path, ".tickPrice"));
        market.priceDecimals = uint8(vm.parseJsonUint(json, string.concat(path, ".priceDecimals")));
        market.priceScale = uint64(vm.parseJsonUint(json, string.concat(path, ".priceScale")));
        market.tickSizeMinor = uint128(vm.parseJsonUint(json, string.concat(path, ".tickSizeMinor")));
        market.payoffMultiplierNumerator = vm.parseJsonUint(json, string.concat(path, ".payoffMultiplierNumerator"));
        market.payoffMultiplierDenominator = vm.parseJsonUint(json, string.concat(path, ".payoffMultiplierDenominator"));
        market.bandMinor = uint128(vm.parseJsonUint(json, string.concat(path, ".bandMinor")));
        market.maxOrderLots = uint128(vm.parseJsonUint(json, string.concat(path, ".maxOrderLots")));
    }

    function _count(string memory json, string memory array, uint256 maximum) private view returns (uint256 count) {
        while (vm.keyExistsJson(json, string.concat(array, "[", vm.toString(count), "]"))) {
            ++count;
            if (count > maximum) revert InvalidMarketListing(array, "too many entries");
        }
    }
}

/// @notice Execution policy, fee and capability identifiers the network bootstrap registers and the runtime publishes.
library NetworkMarketPolicy {
    bytes32 internal constant EXECUTION_MODE_SET = keccak256("SETRYN_EXECUTION_MODE_SET_GENESIS_V1");
    bytes32 internal constant EXECUTION_MODE_PUBLIC_BOOK = keccak256("SETRYN_EXECUTION_MODE_PUBLIC_BOOK_V1");
    bytes32 internal constant EXECUTION_MODE_PRIVATE_RFQ = keccak256("SETRYN_EXECUTION_MODE_PRIVATE_RFQ_V1");
    bytes32 internal constant PRIVACY_MODE_POLICY = keccak256("SETRYN_POLICY_PRIVACY_MODE");
    bytes32 internal constant DISCLOSURE_POLICY = keccak256("SETRYN_POLICY_DISCLOSURE");
    bytes32 internal constant PRIVACY_MODE_BLIND = keccak256("SETRYN_PRIVACY_MODE_BLIND_V1");
    bytes32 internal constant DISCLOSURE_BLIND_QUALIFIED = keccak256("SETRYN_DISCLOSURE_BLIND_QUALIFIED_V1");
    bytes32 internal constant ENTER_ACTION = keccak256("SETRYN_ORDER_ACTION_ENTER_V1");
    /// The capability the signed-observation adapter reports and every network benchmark requires.
    bytes32 internal constant SIGNED_FIXING_CAPABILITY = keccak256("SETRYN_SIGNED_OBSERVATION_FIXING_CAPABILITY_V1");
    uint32 internal constant MAKER_FEE_RATE_PPM = 500;
    uint32 internal constant TAKER_FEE_RATE_PPM = 1_000;
}
