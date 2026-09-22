// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// @dev Transfer-capable mocks for the custody path. TokenMocks.sol stays metadata-only for the
/// registry tests; nothing here changes those.
abstract contract MockCollateralERC20Base {
    uint8 public immutable decimals;

    uint256 public totalSupply;

    mapping(address account => uint256 balance) public balanceOf;

    mapping(address owner => mapping(address spender => uint256 allowance)) public allowance;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        _spendAllowance(from, amount);
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal virtual {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }

    function _spendAllowance(address from, uint256 amount) internal {
        if (from != msg.sender) {
            allowance[from][msg.sender] -= amount;
        }
    }
}

contract MockCollateralERC20 is MockCollateralERC20Base {
    constructor(uint8 decimals_) MockCollateralERC20Base(decimals_) {}
}

/// @dev Delivers less than it debits, the classic fee-on-transfer shape. The vault must reject the
/// deposit rather than credit the requested amount.
contract FeeOnTransferERC20 is MockCollateralERC20Base {
    uint256 public immutable fee;

    constructor(uint8 decimals_, uint256 fee_) MockCollateralERC20Base(decimals_) {
        fee = fee_;
    }

    function _move(address from, address to, uint256 amount) internal override {
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
    }
}

/// @dev Reports success and moves nothing. SafeERC20 accepts an empty return from a contract, so only
/// the vault's own exact-receipt measurement catches this one.
contract SilentNoOpERC20 is MockCollateralERC20Base {
    constructor(uint8 decimals_) MockCollateralERC20Base(decimals_) {}

    function transfer(address, uint256) external pure override returns (bool) {
        return true;
    }

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        return true;
    }
}

contract FalseReturnERC20 is MockCollateralERC20Base {
    constructor(uint8 decimals_) MockCollateralERC20Base(decimals_) {}

    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        return false;
    }
}

/// @dev Calls back into an arbitrary target from inside transferFrom, which is the only window a
/// token has to reenter the vault mid-deposit.
contract ReentrantERC20 is MockCollateralERC20Base {
    address private _target;

    bytes private _payload;

    bool private _armed;

    constructor(uint8 decimals_) MockCollateralERC20Base(decimals_) {}

    function arm(address target, bytes calldata payload) external {
        _target = target;
        _payload = payload;
        _armed = true;
    }

    /// @dev A reverted deposit rolls the armed flag back, so a test that wants a clean transfer after
    /// a failed reentrancy attempt has to disarm explicitly.
    function disarm() external {
        _armed = false;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        if (_armed) {
            _armed = false;
            (bool ok, bytes memory returnData) = _target.call(_payload);
            if (!ok) {
                assembly {
                    revert(add(returnData, 0x20), mload(returnData))
                }
            }
        }
        _spendAllowance(from, amount);
        _move(from, to, amount);
        return true;
    }
}
