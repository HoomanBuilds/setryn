// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// @dev Minimal metadata-only mocks. The registry never transfers, so no balance or allowance
/// machinery is needed to exercise it.
contract MockERC20Metadata {
    uint8 private _decimals;

    constructor(uint8 initialDecimals) {
        _decimals = initialDecimals;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function setDecimals(uint8 newDecimals) external {
        _decimals = newDecimals;
    }
}

contract RevertingDecimalsToken {
    error DecimalsUnsupported();

    function decimals() external pure returns (uint8) {
        revert DecimalsUnsupported();
    }
}

/// @dev Accepts any call and returns empty data, the shape of a token that simply has no decimals
/// function behind a permissive fallback.
contract SilentDecimalsToken {
    fallback() external {}
}

/// @dev Returns a truncated word, so the staticcall succeeds but the payload cannot be decoded.
contract ShortReturnDecimalsToken {
    fallback() external {
        assembly {
            mstore(0x00, 18)
            return(0x00, 16)
        }
    }
}

/// @dev Returns a well-formed word whose value cannot fit in uint8.
contract OversizedDecimalsToken {
    function decimals() external pure returns (uint256) {
        return 300;
    }
}
