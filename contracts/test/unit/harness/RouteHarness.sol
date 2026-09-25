// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RouteLib} from "../../../src/libraries/RouteLib.sol";
import {
    CoincidencePlan,
    ExecutableRoute,
    RouteCandidate,
    RouteComponent,
    RouteRiskBinding
} from "../../../src/types/RoutingTypes.sol";
import {PackageLeg} from "../../../src/types/PackageDefinition.sol";

contract RouteHarness {
    function validate(RouteCandidate calldata candidate, uint256 currentTimestamp) external pure {
        RouteLib.validateCandidate(candidate, currentTimestamp);
    }

    function hashComponents(RouteComponent[] calldata components) external pure returns (bytes32) {
        return RouteLib.hashComponents(components);
    }

    function hashRiskBindings(RouteRiskBinding[] calldata bindings) external pure returns (bytes32) {
        return RouteLib.hashRiskBindings(bindings);
    }

    function hashRoute(ExecutableRoute calldata route) external pure returns (bytes32) {
        return RouteLib.hashRoute(route);
    }

    function validateCoincidence(CoincidencePlan calldata plan, PackageLeg[] calldata packageLegs)
        external
        pure
        returns (bytes32)
    {
        return RouteLib.validateCoincidence(plan, packageLegs);
    }
}
