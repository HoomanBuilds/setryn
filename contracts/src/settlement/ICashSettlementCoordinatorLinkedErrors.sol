// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// Errors raised by internal library code that now executes inside linked libraries. Declaring them here keeps
/// them in CashSettlementCoordinator's ABI exactly as before the modular split, so clients decode every revert unchanged.
interface ICashSettlementCoordinatorLinkedErrors {
    error ZeroDefinitionHash();
}
