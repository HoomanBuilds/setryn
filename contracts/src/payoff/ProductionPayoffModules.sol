// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CanonicalPayoffModule} from "./CanonicalPayoffModule.sol";
import {PayoffFamilyId} from "../types/Identifiers.sol";
import {PayoffKind} from "../types/PayoffTypes.sol";

contract CappedForwardPayoffModule is CanonicalPayoffModule {
    constructor()
        CanonicalPayoffModule(PayoffFamilyId.wrap(keccak256("SETRYN_CAPPED_FORWARD_V1")), PayoffKind.CappedForward)
    {}
}

contract NdfPayoffModule is CanonicalPayoffModule {
    constructor() CanonicalPayoffModule(PayoffFamilyId.wrap(keccak256("SETRYN_NDF_V1")), PayoffKind.Ndf) {}
}

contract EuropeanCallPayoffModule is CanonicalPayoffModule {
    constructor()
        CanonicalPayoffModule(PayoffFamilyId.wrap(keccak256("SETRYN_EUROPEAN_CALL_V1")), PayoffKind.EuropeanCall)
    {}
}

contract EuropeanPutPayoffModule is CanonicalPayoffModule {
    constructor()
        CanonicalPayoffModule(PayoffFamilyId.wrap(keccak256("SETRYN_EUROPEAN_PUT_V1")), PayoffKind.EuropeanPut)
    {}
}

contract CollarPayoffModule is CanonicalPayoffModule {
    constructor() CanonicalPayoffModule(PayoffFamilyId.wrap(keccak256("SETRYN_COLLAR_V1")), PayoffKind.Collar) {}
}

contract RateForwardPayoffModule is CanonicalPayoffModule {
    constructor()
        CanonicalPayoffModule(PayoffFamilyId.wrap(keccak256("SETRYN_RATE_FORWARD_V1")), PayoffKind.RateForward)
    {}
}

contract RateCapPayoffModule is CanonicalPayoffModule {
    constructor() CanonicalPayoffModule(PayoffFamilyId.wrap(keccak256("SETRYN_RATE_CAP_V1")), PayoffKind.RateCap) {}
}

contract RateFloorPayoffModule is CanonicalPayoffModule {
    constructor() CanonicalPayoffModule(PayoffFamilyId.wrap(keccak256("SETRYN_RATE_FLOOR_V1")), PayoffKind.RateFloor) {}
}

contract RateCollarPayoffModule is CanonicalPayoffModule {
    constructor()
        CanonicalPayoffModule(PayoffFamilyId.wrap(keccak256("SETRYN_RATE_COLLAR_V1")), PayoffKind.RateCollar)
    {}
}

contract BasisSpreadPayoffModule is CanonicalPayoffModule {
    constructor()
        CanonicalPayoffModule(PayoffFamilyId.wrap(keccak256("SETRYN_BASIS_SPREAD_V1")), PayoffKind.BasisSpread)
    {}
}

contract CalendarSpreadPayoffModule is CanonicalPayoffModule {
    constructor()
        CanonicalPayoffModule(PayoffFamilyId.wrap(keccak256("SETRYN_CALENDAR_SPREAD_V1")), PayoffKind.CalendarSpread)
    {}
}

contract WindowAverageScalarPayoffModule is CanonicalPayoffModule {
    constructor()
        CanonicalPayoffModule(
            PayoffFamilyId.wrap(keccak256("SETRYN_WINDOW_AVERAGE_SCALAR_V1")), PayoffKind.WindowAverageScalar
        )
    {}
}

contract CorrelationDispersionScalarPayoffModule is CanonicalPayoffModule {
    constructor()
        CanonicalPayoffModule(
            PayoffFamilyId.wrap(keccak256("SETRYN_CORRELATION_DISPERSION_SCALAR_V1")),
            PayoffKind.CorrelationDispersionScalar
        )
    {}
}
