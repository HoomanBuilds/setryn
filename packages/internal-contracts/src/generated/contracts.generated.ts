import type { InternalContractBinding } from "../types.ts";

export const generatedBindingsHash = "sha256:89270289e7c727c4ad627e7d8df3b3d0f3b2d9d0acca022b8a8731500ffbea68";

export const contractBindings = {
  "AssetRegistry": {
    "artifact": "contracts/out/AssetRegistry.sol/AssetRegistry.json",
    "sourceName": "src/registry/AssetRegistry.sol",
    "contractName": "AssetRegistry",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "REGISTRAR_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "STATUS_MANAGER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activateAsset",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "assetCount",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deprecateAsset",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "exists",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getAsset",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ],
        "outputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct AssetDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "symbol",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "assetClass",
                "type": "uint8",
                "internalType": "enum AssetClass"
              },
              {
                "name": "decimals",
                "type": "uint8",
                "internalType": "uint8"
              }
            ]
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isActive",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pauseAsset",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "registerAsset",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct AssetDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "symbol",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "assetClass",
                "type": "uint8",
                "internalType": "enum AssetClass"
              },
              {
                "name": "decimals",
                "type": "uint8",
                "internalType": "uint8"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "statusOf",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "event",
        "name": "AssetRegistered",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AssetId"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "namespaceId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "referenceId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "symbol",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "assetClass",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum AssetClass"
          },
          {
            "name": "decimals",
            "type": "uint8",
            "indexed": false,
            "internalType": "uint8"
          },
          {
            "name": "registrar",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "AssetStatusChanged",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AssetId"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AssetAlreadyRegistered",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "storedDefinitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "submittedDefinitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidStatusTransition",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownAsset",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnspecifiedAssetClass",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroDefinitionHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroNamespaceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroReferenceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSymbol",
        "inputs": []
      }
    ]
  },
  "SettlementAssetRegistry": {
    "artifact": "contracts/out/SettlementAssetRegistry.sol/SettlementAssetRegistry.json",
    "sourceName": "src/registry/SettlementAssetRegistry.sol",
    "contractName": "SettlementAssetRegistry",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "assetRegistry_",
            "type": "address",
            "internalType": "contract IAssetRegistry"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "QUALIFIER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "STATUS_MANAGER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activateBinding",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activeVersion",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "assetRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IAssetRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "bindingCount",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deprecateBinding",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "getBinding",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "tuple",
            "internalType": "struct SettlementAssetBinding",
            "components": [
              {
                "name": "definition",
                "type": "tuple",
                "internalType": "struct SettlementAssetDefinition",
                "components": [
                  {
                    "name": "assetId",
                    "type": "bytes32",
                    "internalType": "AssetId"
                  },
                  {
                    "name": "token",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "expectedRuntimeCodeHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "qualificationHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              },
              {
                "name": "definitionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "versionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "version",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "decimals",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum RegistryStatus"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isLifecycleEnabled",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isOpenForNewRisk",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "latestVersion",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pauseBinding",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "registerBinding",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct SettlementAssetDefinition",
            "components": [
              {
                "name": "assetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "expectedRuntimeCodeHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "qualificationHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "runtimeMatches",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "statusOf",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "tokenAsset",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "SettlementAssetActiveVersionChanged",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AssetId"
          },
          {
            "name": "previousVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "newVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "SettlementAssetRegistered",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "versionHash",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "token",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          },
          {
            "name": "expectedRuntimeCodeHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "decimals",
            "type": "uint8",
            "indexed": false,
            "internalType": "uint8"
          },
          {
            "name": "qualificationHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "chainId",
            "type": "uint256",
            "indexed": false,
            "internalType": "uint256"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "SettlementAssetStatusChanged",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AnotherVersionActive",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "activeVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AssetRegistryHasNoCode",
        "inputs": [
          {
            "name": "assetRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "CanonicalAssetNotActive",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "CanonicalDecimalsOutOfRange",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "decimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "maxDecimals",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateSettlementDefinition",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "existingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidBindingTransition",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "RuntimeCodeHashMismatch",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "expectedCodeHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actualCodeHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "SettlementTokenHasNoCode",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "TokenBoundToDifferentAsset",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "boundAssetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "submittedAssetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ]
      },
      {
        "type": "error",
        "name": "TokenDecimalsMalformed",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "reportedDecimals",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "TokenDecimalsMismatch",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "canonicalDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "reportedDecimals",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "type": "error",
        "name": "TokenDecimalsUnavailable",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownBinding",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownCanonicalAsset",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ]
      },
      {
        "type": "error",
        "name": "VersionExhausted",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ]
      },
      {
        "type": "error",
        "name": "ZeroAssetRegistry",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroQualificationHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRuntimeCodeHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSettlementToken",
        "inputs": []
      }
    ]
  },
  "AdapterRegistry": {
    "artifact": "contracts/out/AdapterRegistry.sol/AdapterRegistry.json",
    "sourceName": "src/registry/AdapterRegistry.sol",
    "contractName": "AdapterRegistry",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "ADAPTER_QUALIFIER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "ADAPTER_STATUS_MANAGER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activateAdapter",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activeVersion",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "adapterCount",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deprecateAdapter",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "deriveAdapterId",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct AdapterDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "kindId",
                "type": "bytes32",
                "internalType": "AdapterKindId"
              },
              {
                "name": "implementation",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "expectedRuntimeCodeHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "interfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "capabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "configurationSchemaHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "AdapterId"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "exists",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getAdapter",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "tuple",
            "internalType": "struct AdapterVersion",
            "components": [
              {
                "name": "definition",
                "type": "tuple",
                "internalType": "struct AdapterDefinition",
                "components": [
                  {
                    "name": "namespaceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "referenceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "kindId",
                    "type": "bytes32",
                    "internalType": "AdapterKindId"
                  },
                  {
                    "name": "implementation",
                    "type": "address",
                    "internalType": "address"
                  },
                  {
                    "name": "expectedRuntimeCodeHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "interfaceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "capabilityHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "configurationSchemaHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "evidenceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              },
              {
                "name": "definitionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "versionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "version",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum RegistryStatus"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isLifecycleEnabled",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isOpenForNewRisk",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "latestVersion",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pauseAdapter",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "registerAdapter",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct AdapterDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "kindId",
                "type": "bytes32",
                "internalType": "AdapterKindId"
              },
              {
                "name": "implementation",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "expectedRuntimeCodeHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "interfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "capabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "configurationSchemaHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "runtimeMatches",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "statusOf",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "event",
        "name": "AdapterActiveVersionChanged",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AdapterId"
          },
          {
            "name": "previousVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "newVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "AdapterRegistered",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "versionHash",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "definition",
            "type": "tuple",
            "indexed": false,
            "internalType": "struct AdapterDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "kindId",
                "type": "bytes32",
                "internalType": "AdapterKindId"
              },
              {
                "name": "implementation",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "expectedRuntimeCodeHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "interfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "capabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "configurationSchemaHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "chainId",
            "type": "uint256",
            "indexed": false,
            "internalType": "uint256"
          },
          {
            "name": "initialStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "AdapterStatusChanged",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AdapterImplementationHasNoCode",
        "inputs": [
          {
            "name": "implementation",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AdapterRuntimeCodeHashMismatch",
        "inputs": [
          {
            "name": "implementation",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "expectedCodeHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actualCodeHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AdapterVersionExhausted",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          }
        ]
      },
      {
        "type": "error",
        "name": "AnotherAdapterVersionActive",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "activeVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateAdapterDefinition",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "existingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidAdapterTransition",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownAdapterVersion",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "ZeroAdapterCapabilityHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroAdapterConfigurationSchemaHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroAdapterEvidenceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroAdapterImplementation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroAdapterInterfaceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroAdapterKindId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroAdapterNamespaceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroAdapterReferenceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroAdapterRuntimeCodeHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroDefinitionHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      }
    ]
  },
  "CalendarRegistry": {
    "artifact": "contracts/out/CalendarRegistry.sol/CalendarRegistry.json",
    "sourceName": "src/registry/CalendarRegistry.sol",
    "contractName": "CalendarRegistry",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "CALENDAR_REGISTRAR_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "CALENDAR_STATUS_MANAGER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activateCalendar",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activeVersion",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "calendarCount",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "coversDay",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deprecateCalendar",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "exists",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getCalendar",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "tuple",
            "internalType": "struct CalendarVersion",
            "components": [
              {
                "name": "definition",
                "type": "tuple",
                "internalType": "struct CalendarDefinition",
                "components": [
                  {
                    "name": "namespaceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "referenceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "timeZoneId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "weekendMask",
                    "type": "uint8",
                    "internalType": "uint8"
                  },
                  {
                    "name": "validFromDay",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "validThroughDay",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "dayStatusRoot",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "ruleSetHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "sourceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              },
              {
                "name": "definitionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "versionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "version",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum RegistryStatus"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "hashDay",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "calendarDay",
            "type": "tuple",
            "internalType": "struct CalendarDay",
            "components": [
              {
                "name": "day",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "isBusinessDay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "isLifecycleEnabled",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isOpenForNewRisk",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "latestVersion",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pauseCalendar",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "registerCalendar",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct CalendarDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "timeZoneId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "weekendMask",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "validFromDay",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "validThroughDay",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "dayStatusRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "ruleSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "sourceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "statusOf",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "verifyDay",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "calendarDay",
            "type": "tuple",
            "internalType": "struct CalendarDay",
            "components": [
              {
                "name": "day",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "isBusinessDay",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "proof",
            "type": "bytes32[]",
            "internalType": "bytes32[]"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "event",
        "name": "CalendarActiveVersionChanged",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CalendarId"
          },
          {
            "name": "previousVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "newVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "CalendarRegistered",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "versionHash",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "definition",
            "type": "tuple",
            "indexed": false,
            "internalType": "struct CalendarDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "timeZoneId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "weekendMask",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "validFromDay",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "validThroughDay",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "dayStatusRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "ruleSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "sourceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "initialStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "CalendarStatusChanged",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AnotherCalendarVersionActive",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "activeVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "CalendarVersionExhausted",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateCalendarDefinition",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "existingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "EmptyBusinessWeek",
        "inputs": [
          {
            "name": "weekendMask",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidCalendarHorizon",
        "inputs": [
          {
            "name": "validFromDay",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validThroughDay",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidCalendarTransition",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidWeekendMask",
        "inputs": [
          {
            "name": "weekendMask",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownCalendarVersion",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "ZeroCalendarNamespaceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroCalendarReferenceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroCalendarSourceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroDayStatusRoot",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroDefinitionHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroEvidenceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRuleSetHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroTimeZoneId",
        "inputs": []
      }
    ]
  },
  "SessionRegistry": {
    "artifact": "contracts/out/SessionRegistry.sol/SessionRegistry.json",
    "sourceName": "src/registry/SessionRegistry.sol",
    "contractName": "SessionRegistry",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "calendarRegistry_",
            "type": "address",
            "internalType": "contract ICalendarRegistry"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "SESSION_REGISTRAR_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "SESSION_STATUS_MANAGER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activateSession",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activeVersion",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "calendarRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract ICalendarRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "coversDay",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deprecateSession",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "exists",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getSession",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "tuple",
            "internalType": "struct SessionVersion",
            "components": [
              {
                "name": "definition",
                "type": "tuple",
                "internalType": "struct SessionDefinition",
                "components": [
                  {
                    "name": "namespaceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "referenceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "calendarId",
                    "type": "bytes32",
                    "internalType": "CalendarId"
                  },
                  {
                    "name": "calendarVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "validFromDay",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "validThroughDay",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "dayScheduleRoot",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "windowKindSetHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "ruleSetHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "sourceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              },
              {
                "name": "definitionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "versionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "version",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum RegistryStatus"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "hashDay",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "sessionDay",
            "type": "tuple",
            "internalType": "struct SessionDay",
            "components": [
              {
                "name": "day",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "windowsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "hashWindow",
        "inputs": [
          {
            "name": "window",
            "type": "tuple",
            "internalType": "struct SessionWindow",
            "components": [
              {
                "name": "kindId",
                "type": "bytes32",
                "internalType": "WindowKindId"
              },
              {
                "name": "opensAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "closesAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "policyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "hashWindows",
        "inputs": [
          {
            "name": "windows",
            "type": "tuple[]",
            "internalType": "struct SessionWindow[]",
            "components": [
              {
                "name": "kindId",
                "type": "bytes32",
                "internalType": "WindowKindId"
              },
              {
                "name": "opensAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "closesAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "policyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "isLifecycleEnabled",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isOpenForNewRisk",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "latestVersion",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pauseSession",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "registerSession",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct SessionDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "calendarId",
                "type": "bytes32",
                "internalType": "CalendarId"
              },
              {
                "name": "calendarVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "validFromDay",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "validThroughDay",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "dayScheduleRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "windowKindSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "ruleSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "sourceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "sessionCount",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "statusOf",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "verifyDay",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "sessionDay",
            "type": "tuple",
            "internalType": "struct SessionDay",
            "components": [
              {
                "name": "day",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "windowsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "proof",
            "type": "bytes32[]",
            "internalType": "bytes32[]"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "SessionActiveVersionChanged",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "SessionId"
          },
          {
            "name": "previousVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "newVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "SessionRegistered",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "versionHash",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "definition",
            "type": "tuple",
            "indexed": false,
            "internalType": "struct SessionDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "calendarId",
                "type": "bytes32",
                "internalType": "CalendarId"
              },
              {
                "name": "calendarVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "validFromDay",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "validThroughDay",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "dayScheduleRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "windowKindSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "ruleSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "sourceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "initialStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "SessionStatusChanged",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AnotherSessionVersionActive",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "activeVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "CalendarDependencyNotOpen",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "calendarVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validFromDay",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validThroughDay",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "CalendarHorizonTooNarrow",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "calendarVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validFromDay",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validThroughDay",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "CalendarRegistryHasNoCode",
        "inputs": [
          {
            "name": "calendarRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateSessionDefinition",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "existingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateSessionWindow",
        "inputs": [
          {
            "name": "index",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidSessionHorizon",
        "inputs": [
          {
            "name": "validFromDay",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validThroughDay",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidSessionTransition",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidWindowInterval",
        "inputs": [
          {
            "name": "opensAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "closesAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "SessionVersionExhausted",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          }
        ]
      },
      {
        "type": "error",
        "name": "TooManyWindows",
        "inputs": [
          {
            "name": "count",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownCalendarDependency",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "calendarVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownSessionVersion",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnorderedSessionWindows",
        "inputs": [
          {
            "name": "index",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "ZeroCalendarRegistry",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroDayScheduleRoot",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroDefinitionHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSessionCalendarId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSessionCalendarVersion",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSessionEvidenceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSessionNamespaceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSessionReferenceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSessionRuleSetHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSessionSourceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroWindowKindId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroWindowKindSetHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroWindowPolicyHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroWindowsHash",
        "inputs": []
      }
    ]
  },
  "BenchmarkRegistry": {
    "artifact": "contracts/out/BenchmarkRegistry.sol/BenchmarkRegistry.json",
    "sourceName": "src/registry/BenchmarkRegistry.sol",
    "contractName": "BenchmarkRegistry",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "assetRegistry_",
            "type": "address",
            "internalType": "contract IAssetRegistry"
          },
          {
            "name": "adapterRegistry_",
            "type": "address",
            "internalType": "contract IAdapterRegistry"
          },
          {
            "name": "calendarRegistry_",
            "type": "address",
            "internalType": "contract ICalendarRegistry"
          },
          {
            "name": "sessionRegistry_",
            "type": "address",
            "internalType": "contract ISessionRegistry"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "BENCHMARK_QUALIFIER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "BENCHMARK_STATUS_MANAGER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activateBenchmark",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activeVersion",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "adapterRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IAdapterRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "assetRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IAssetRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "benchmarkCount",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "calendarRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract ICalendarRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "coversDay",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deprecateBenchmark",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "deriveBenchmarkId",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct BenchmarkDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "kindId",
                "type": "bytes32",
                "internalType": "BenchmarkKindId"
              },
              {
                "name": "baseAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "quoteAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "adapterId",
                "type": "bytes32",
                "internalType": "AdapterId"
              },
              {
                "name": "adapterVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "calendarId",
                "type": "bytes32",
                "internalType": "CalendarId"
              },
              {
                "name": "calendarVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "sessionId",
                "type": "bytes32",
                "internalType": "SessionId"
              },
              {
                "name": "sessionVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "feedKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredInterfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredCapabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "outputDecimals",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "maxStalenessSeconds",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "maxFutureSkewSeconds",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "maxConfidenceBps",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "observationRuleHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "fallbackPolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "disruptionPolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "dataRightsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "exists",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getBenchmark",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "tuple",
            "internalType": "struct BenchmarkVersion",
            "components": [
              {
                "name": "definition",
                "type": "tuple",
                "internalType": "struct BenchmarkDefinition",
                "components": [
                  {
                    "name": "namespaceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "referenceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "kindId",
                    "type": "bytes32",
                    "internalType": "BenchmarkKindId"
                  },
                  {
                    "name": "baseAssetId",
                    "type": "bytes32",
                    "internalType": "AssetId"
                  },
                  {
                    "name": "quoteAssetId",
                    "type": "bytes32",
                    "internalType": "AssetId"
                  },
                  {
                    "name": "adapterId",
                    "type": "bytes32",
                    "internalType": "AdapterId"
                  },
                  {
                    "name": "adapterVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "calendarId",
                    "type": "bytes32",
                    "internalType": "CalendarId"
                  },
                  {
                    "name": "calendarVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "sessionId",
                    "type": "bytes32",
                    "internalType": "SessionId"
                  },
                  {
                    "name": "sessionVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "feedKey",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "requiredInterfaceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "requiredCapabilityHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "outputDecimals",
                    "type": "uint8",
                    "internalType": "uint8"
                  },
                  {
                    "name": "maxStalenessSeconds",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "maxFutureSkewSeconds",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "maxConfidenceBps",
                    "type": "uint16",
                    "internalType": "uint16"
                  },
                  {
                    "name": "observationRuleHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "fallbackPolicyHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "disruptionPolicyHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "dataRightsHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "evidenceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              },
              {
                "name": "definitionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "versionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "version",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum RegistryStatus"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isLifecycleEnabled",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isOpenForNewRisk",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "latestVersion",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pauseBenchmark",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "registerBenchmark",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct BenchmarkDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "kindId",
                "type": "bytes32",
                "internalType": "BenchmarkKindId"
              },
              {
                "name": "baseAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "quoteAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "adapterId",
                "type": "bytes32",
                "internalType": "AdapterId"
              },
              {
                "name": "adapterVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "calendarId",
                "type": "bytes32",
                "internalType": "CalendarId"
              },
              {
                "name": "calendarVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "sessionId",
                "type": "bytes32",
                "internalType": "SessionId"
              },
              {
                "name": "sessionVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "feedKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredInterfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredCapabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "outputDecimals",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "maxStalenessSeconds",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "maxFutureSkewSeconds",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "maxConfidenceBps",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "observationRuleHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "fallbackPolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "disruptionPolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "dataRightsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "sessionRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract ISessionRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "statusOf",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "event",
        "name": "BenchmarkActiveVersionChanged",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "BenchmarkId"
          },
          {
            "name": "previousVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "newVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "BenchmarkRegistered",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "versionHash",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "definition",
            "type": "tuple",
            "indexed": false,
            "internalType": "struct BenchmarkDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "referenceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "kindId",
                "type": "bytes32",
                "internalType": "BenchmarkKindId"
              },
              {
                "name": "baseAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "quoteAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "adapterId",
                "type": "bytes32",
                "internalType": "AdapterId"
              },
              {
                "name": "adapterVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "calendarId",
                "type": "bytes32",
                "internalType": "CalendarId"
              },
              {
                "name": "calendarVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "sessionId",
                "type": "bytes32",
                "internalType": "SessionId"
              },
              {
                "name": "sessionVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "feedKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredInterfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredCapabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "outputDecimals",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "maxStalenessSeconds",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "maxFutureSkewSeconds",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "maxConfidenceBps",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "observationRuleHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "fallbackPolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "disruptionPolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "dataRightsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "chainId",
            "type": "uint256",
            "indexed": false,
            "internalType": "uint256"
          },
          {
            "name": "initialStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "BenchmarkStatusChanged",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AdapterCapabilityMismatch",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "adapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "requiredCapabilityHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actualCapabilityHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AdapterDependencyNotOpen",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "adapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AdapterInterfaceMismatch",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "adapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "requiredInterfaceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actualInterfaceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AdapterKindMismatch",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "adapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "expectedKindId",
            "type": "bytes32",
            "internalType": "AdapterKindId"
          },
          {
            "name": "actualKindId",
            "type": "bytes32",
            "internalType": "AdapterKindId"
          }
        ]
      },
      {
        "type": "error",
        "name": "AdapterRegistryHasNoCode",
        "inputs": [
          {
            "name": "adapterRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AnotherBenchmarkVersionActive",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "activeVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AssetDependencyNotActive",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "AssetRegistryHasNoCode",
        "inputs": [
          {
            "name": "assetRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "BenchmarkConfidenceOutOfRange",
        "inputs": [
          {
            "name": "maxConfidenceBps",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      },
      {
        "type": "error",
        "name": "BenchmarkDecimalsOutOfRange",
        "inputs": [
          {
            "name": "outputDecimals",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "type": "error",
        "name": "BenchmarkVersionExhausted",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          }
        ]
      },
      {
        "type": "error",
        "name": "CalendarDependencyNotOpen",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "calendarVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validFromDay",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validThroughDay",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "CalendarRegistryHasNoCode",
        "inputs": [
          {
            "name": "calendarRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "DependencyGraphMismatch",
        "inputs": [
          {
            "name": "expectedCalendarRegistry",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sessionCalendarRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateBenchmarkDefinition",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "existingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "IdenticalBenchmarkAssets",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidBenchmarkTransition",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "SessionCalendarMismatch",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "sessionVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "benchmarkCalendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "benchmarkCalendarVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "sessionCalendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "sessionCalendarVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "SessionDependencyNotOpen",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "sessionVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validFromDay",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "validThroughDay",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "SessionRegistryHasNoCode",
        "inputs": [
          {
            "name": "sessionRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownAdapterDependency",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "adapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownAssetDependency",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownBenchmarkVersion",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownCalendarDependency",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "calendarVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownSessionDependency",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "sessionVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "ZeroAdapterRegistry",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroAssetRegistry",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkAdapterId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkAdapterVersion",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkBaseAssetId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkCalendarId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkCalendarVersion",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkDataRightsHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkDisruptionPolicyHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkEvidenceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkFallbackPolicyHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkFeedKey",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkKindId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkMaxStalenessSeconds",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkNamespaceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkObservationRuleHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkQuoteAssetId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkReferenceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkRequiredCapabilityHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkRequiredInterfaceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkSessionId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroBenchmarkSessionVersion",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroCalendarRegistry",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroDefinitionHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSessionRegistry",
        "inputs": []
      }
    ]
  },
  "FeeScheduleRegistry": {
    "artifact": "contracts/out/FeeScheduleRegistry.sol/FeeScheduleRegistry.json",
    "sourceName": "src/registry/FeeScheduleRegistry.sol",
    "contractName": "FeeScheduleRegistry",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "settlementAssetRegistry_",
            "type": "address",
            "internalType": "contract ISettlementAssetRegistry"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "FEE_RATE_PPM_DENOMINATOR",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "FEE_SCHEDULE_QUALIFIER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "FEE_SCHEDULE_STATUS_MANAGER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activateFeeSchedule",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activeVersion",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deprecateFeeSchedule",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "deriveFeeScheduleId",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct FeeScheduleDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "scheduleKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "feeModelId",
                "type": "bytes32",
                "internalType": "FeeModelId"
              },
              {
                "name": "settlementAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "settlementAssetVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "feeRulesHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "recipientsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxChargeRatePpm",
                "type": "uint32",
                "internalType": "FeeRatePpm"
              },
              {
                "name": "maxRebateRatePpm",
                "type": "uint32",
                "internalType": "FeeRatePpm"
              },
              {
                "name": "maxFlatChargeBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxFlatRebateBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "exists",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "feeScheduleCount",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getFeeSchedule",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "tuple",
            "internalType": "struct FeeScheduleVersion",
            "components": [
              {
                "name": "definition",
                "type": "tuple",
                "internalType": "struct FeeScheduleDefinition",
                "components": [
                  {
                    "name": "namespaceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "scheduleKey",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "feeModelId",
                    "type": "bytes32",
                    "internalType": "FeeModelId"
                  },
                  {
                    "name": "settlementAssetId",
                    "type": "bytes32",
                    "internalType": "AssetId"
                  },
                  {
                    "name": "settlementAssetVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "feeRulesHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "recipientsHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "maxChargeRatePpm",
                    "type": "uint32",
                    "internalType": "FeeRatePpm"
                  },
                  {
                    "name": "maxRebateRatePpm",
                    "type": "uint32",
                    "internalType": "FeeRatePpm"
                  },
                  {
                    "name": "maxFlatChargeBaseUnits",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "maxFlatRebateBaseUnits",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "evidenceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              },
              {
                "name": "definitionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "versionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "version",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum RegistryStatus"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isLifecycleEnabled",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isOpenForNewRisk",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "latestVersion",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pauseFeeSchedule",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "registerFeeSchedule",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct FeeScheduleDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "scheduleKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "feeModelId",
                "type": "bytes32",
                "internalType": "FeeModelId"
              },
              {
                "name": "settlementAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "settlementAssetVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "feeRulesHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "recipientsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxChargeRatePpm",
                "type": "uint32",
                "internalType": "FeeRatePpm"
              },
              {
                "name": "maxRebateRatePpm",
                "type": "uint32",
                "internalType": "FeeRatePpm"
              },
              {
                "name": "maxFlatChargeBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxFlatRebateBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "settlementAssetRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract ISettlementAssetRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "statusOf",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "FeeScheduleActiveVersionChanged",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "FeeScheduleId"
          },
          {
            "name": "previousVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "newVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "FeeScheduleRegistered",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "versionHash",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "definition",
            "type": "tuple",
            "indexed": false,
            "internalType": "struct FeeScheduleDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "scheduleKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "feeModelId",
                "type": "bytes32",
                "internalType": "FeeModelId"
              },
              {
                "name": "settlementAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "settlementAssetVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "feeRulesHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "recipientsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxChargeRatePpm",
                "type": "uint32",
                "internalType": "FeeRatePpm"
              },
              {
                "name": "maxRebateRatePpm",
                "type": "uint32",
                "internalType": "FeeRatePpm"
              },
              {
                "name": "maxFlatChargeBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxFlatRebateBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "evidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "chainId",
            "type": "uint256",
            "indexed": false,
            "internalType": "uint256"
          },
          {
            "name": "initialStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "FeeScheduleStatusChanged",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AnotherFeeScheduleVersionActive",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "activeVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateFeeScheduleDefinition",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "existingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "FeeChargeRateOutOfRange",
        "inputs": [
          {
            "name": "maxChargeRatePpm",
            "type": "uint32",
            "internalType": "FeeRatePpm"
          }
        ]
      },
      {
        "type": "error",
        "name": "FeeRebateRateOutOfRange",
        "inputs": [
          {
            "name": "maxRebateRatePpm",
            "type": "uint32",
            "internalType": "FeeRatePpm"
          }
        ]
      },
      {
        "type": "error",
        "name": "FeeScheduleVersionExhausted",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          }
        ]
      },
      {
        "type": "error",
        "name": "IneffectiveFeeSchedule",
        "inputs": []
      },
      {
        "type": "error",
        "name": "InvalidFeeScheduleTransition",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "SettlementAssetDependencyNotOpen",
        "inputs": [
          {
            "name": "settlementAssetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "settlementAssetVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "SettlementAssetRegistryHasNoCode",
        "inputs": [
          {
            "name": "settlementAssetRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownFeeScheduleVersion",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownSettlementAssetDependency",
        "inputs": [
          {
            "name": "settlementAssetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "settlementAssetVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "ZeroDefinitionHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroFeeModelId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroFeeRecipientsHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroFeeRulesHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroFeeScheduleEvidenceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroFeeScheduleKey",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroFeeScheduleNamespaceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroFeeScheduleSettlementAssetId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroFeeScheduleSettlementAssetVersion",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSettlementAssetRegistry",
        "inputs": []
      }
    ]
  },
  "RiskDomainRegistry": {
    "artifact": "contracts/out/RiskDomainRegistry.sol/RiskDomainRegistry.json",
    "sourceName": "src/registry/RiskDomainRegistry.sol",
    "contractName": "RiskDomainRegistry",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "settlementAssetRegistry_",
            "type": "address",
            "internalType": "contract ISettlementAssetRegistry"
          },
          {
            "name": "adapterRegistry_",
            "type": "address",
            "internalType": "contract IAdapterRegistry"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "RISK_DOMAIN_QUALIFIER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "RISK_DOMAIN_STATUS_MANAGER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activateRiskDomain",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activeVersion",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "adapterRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IAdapterRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deprecateRiskDomain",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "deriveRiskDomainId",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct RiskDomainDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "domainKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "riskModelId",
                "type": "bytes32",
                "internalType": "RiskModelId"
              },
              {
                "name": "collateralAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "collateralAssetVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "riskAdapterId",
                "type": "bytes32",
                "internalType": "AdapterId"
              },
              {
                "name": "riskAdapterVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "requiredAdapterKindId",
                "type": "bytes32",
                "internalType": "AdapterKindId"
              },
              {
                "name": "requiredInterfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredCapabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marginRulesHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "scenarioSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "concentrationRulesHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "defaultProcessHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "insurancePolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxOpenInterestBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAggregateLiabilityBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAccountLiabilityBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAggregateReservationBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAccountReservationBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "exists",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRiskDomain",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "tuple",
            "internalType": "struct RiskDomainVersion",
            "components": [
              {
                "name": "definition",
                "type": "tuple",
                "internalType": "struct RiskDomainDefinition",
                "components": [
                  {
                    "name": "namespaceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "domainKey",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "riskModelId",
                    "type": "bytes32",
                    "internalType": "RiskModelId"
                  },
                  {
                    "name": "collateralAssetId",
                    "type": "bytes32",
                    "internalType": "AssetId"
                  },
                  {
                    "name": "collateralAssetVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "riskAdapterId",
                    "type": "bytes32",
                    "internalType": "AdapterId"
                  },
                  {
                    "name": "riskAdapterVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "requiredAdapterKindId",
                    "type": "bytes32",
                    "internalType": "AdapterKindId"
                  },
                  {
                    "name": "requiredInterfaceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "requiredCapabilityHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "marginRulesHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "scenarioSetHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "concentrationRulesHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "defaultProcessHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "insurancePolicyHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "qualificationEvidenceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "maxOpenInterestBaseUnits",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "maxAggregateLiabilityBaseUnits",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "maxAccountLiabilityBaseUnits",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "maxAggregateReservationBaseUnits",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "maxAccountReservationBaseUnits",
                    "type": "uint128",
                    "internalType": "uint128"
                  }
                ]
              },
              {
                "name": "definitionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "versionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "version",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum RegistryStatus"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isLifecycleEnabled",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isOpenForNewRisk",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "latestVersion",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pauseRiskDomain",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "registerRiskDomain",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct RiskDomainDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "domainKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "riskModelId",
                "type": "bytes32",
                "internalType": "RiskModelId"
              },
              {
                "name": "collateralAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "collateralAssetVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "riskAdapterId",
                "type": "bytes32",
                "internalType": "AdapterId"
              },
              {
                "name": "riskAdapterVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "requiredAdapterKindId",
                "type": "bytes32",
                "internalType": "AdapterKindId"
              },
              {
                "name": "requiredInterfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredCapabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marginRulesHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "scenarioSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "concentrationRulesHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "defaultProcessHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "insurancePolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxOpenInterestBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAggregateLiabilityBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAccountLiabilityBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAggregateReservationBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAccountReservationBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "riskDomainCount",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "settlementAssetRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract ISettlementAssetRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "statusOf",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RiskDomainActiveVersionChanged",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "RiskDomainId"
          },
          {
            "name": "previousVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "newVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RiskDomainRegistered",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "versionHash",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "definition",
            "type": "tuple",
            "indexed": false,
            "internalType": "struct RiskDomainDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "domainKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "riskModelId",
                "type": "bytes32",
                "internalType": "RiskModelId"
              },
              {
                "name": "collateralAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "collateralAssetVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "riskAdapterId",
                "type": "bytes32",
                "internalType": "AdapterId"
              },
              {
                "name": "riskAdapterVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "requiredAdapterKindId",
                "type": "bytes32",
                "internalType": "AdapterKindId"
              },
              {
                "name": "requiredInterfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredCapabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marginRulesHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "scenarioSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "concentrationRulesHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "defaultProcessHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "insurancePolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxOpenInterestBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAggregateLiabilityBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAccountLiabilityBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAggregateReservationBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxAccountReservationBaseUnits",
                "type": "uint128",
                "internalType": "uint128"
              }
            ]
          },
          {
            "name": "chainId",
            "type": "uint256",
            "indexed": false,
            "internalType": "uint256"
          },
          {
            "name": "initialStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RiskDomainStatusChanged",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccountLiabilityExceedsAggregate",
        "inputs": [
          {
            "name": "maxAccountLiabilityBaseUnits",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxAggregateLiabilityBaseUnits",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccountReservationExceedsAccountLiability",
        "inputs": [
          {
            "name": "maxAccountReservationBaseUnits",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxAccountLiabilityBaseUnits",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccountReservationExceedsAggregateReservation",
        "inputs": [
          {
            "name": "maxAccountReservationBaseUnits",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxAggregateReservationBaseUnits",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "AdapterRegistryHasNoCode",
        "inputs": [
          {
            "name": "adapterRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AggregateReservationExceedsAggregateLiability",
        "inputs": [
          {
            "name": "maxAggregateReservationBaseUnits",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxAggregateLiabilityBaseUnits",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "AnotherRiskDomainVersionActive",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "activeVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "CollateralDependencyNotOpen",
        "inputs": [
          {
            "name": "collateralAssetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "collateralAssetVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateRiskDomainDefinition",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "existingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidRiskDomainTransition",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "PartialReservationEnablement",
        "inputs": [
          {
            "name": "maxAggregateReservationBaseUnits",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxAccountReservationBaseUnits",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "RiskAdapterCapabilityMismatch",
        "inputs": [
          {
            "name": "riskAdapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "riskAdapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "required",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actual",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "RiskAdapterDependencyNotOpen",
        "inputs": [
          {
            "name": "riskAdapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "riskAdapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "RiskAdapterInterfaceMismatch",
        "inputs": [
          {
            "name": "riskAdapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "riskAdapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "required",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actual",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "RiskAdapterKindMismatch",
        "inputs": [
          {
            "name": "riskAdapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "riskAdapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "required",
            "type": "bytes32",
            "internalType": "AdapterKindId"
          },
          {
            "name": "actual",
            "type": "bytes32",
            "internalType": "AdapterKindId"
          }
        ]
      },
      {
        "type": "error",
        "name": "RiskDomainVersionExhausted",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "SettlementAssetRegistryHasNoCode",
        "inputs": [
          {
            "name": "settlementAssetRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownCollateralDependency",
        "inputs": [
          {
            "name": "collateralAssetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "collateralAssetVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownRiskAdapterDependency",
        "inputs": [
          {
            "name": "riskAdapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "riskAdapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownRiskDomainVersion",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "ZeroAdapterRegistry",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroConcentrationRulesHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroDefaultProcessHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroDefinitionHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInsurancePolicyHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMarginRulesHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMaxAccountLiability",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMaxAggregateLiability",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMaxOpenInterest",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainAdapterId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainAdapterVersion",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainCollateralAssetId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainCollateralAssetVersion",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainEvidenceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainKey",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainNamespaceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainRequiredAdapterKindId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainRequiredCapabilityHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainRequiredInterfaceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskModelId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroScenarioSetHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSettlementAssetRegistry",
        "inputs": []
      }
    ]
  },
  "InstrumentRegistry": {
    "artifact": "contracts/out/InstrumentRegistry.sol/InstrumentRegistry.json",
    "sourceName": "src/registry/InstrumentRegistry.sol",
    "contractName": "InstrumentRegistry",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "adapterRegistry_",
            "type": "address",
            "internalType": "contract IAdapterRegistry"
          },
          {
            "name": "evaluationGasHardCap_",
            "type": "uint64",
            "internalType": "uint64"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "INSTRUMENT_QUALIFIER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "INSTRUMENT_STATUS_MANAGER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activateInstrument",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activeVersion",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "adapterRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IAdapterRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deprecateInstrument",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "deriveInstrumentId",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct InstrumentDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "instrumentKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "payoffFamilyId",
                "type": "bytes32",
                "internalType": "PayoffFamilyId"
              },
              {
                "name": "settlementClassId",
                "type": "bytes32",
                "internalType": "SettlementClassId"
              },
              {
                "name": "payoffModuleId",
                "type": "bytes32",
                "internalType": "AdapterId"
              },
              {
                "name": "payoffModuleVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "requiredAdapterKindId",
                "type": "bytes32",
                "internalType": "AdapterKindId"
              },
              {
                "name": "requiredInterfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredCapabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "termsSchemaHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxFixingSlots",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "maxTermsBytes",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "maxEvaluationGas",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "lifecyclePolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "InstrumentId"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "evaluationGasHardCap",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint64",
            "internalType": "uint64"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "exists",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getInstrument",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "tuple",
            "internalType": "struct InstrumentVersion",
            "components": [
              {
                "name": "definition",
                "type": "tuple",
                "internalType": "struct InstrumentDefinition",
                "components": [
                  {
                    "name": "namespaceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "instrumentKey",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "payoffFamilyId",
                    "type": "bytes32",
                    "internalType": "PayoffFamilyId"
                  },
                  {
                    "name": "settlementClassId",
                    "type": "bytes32",
                    "internalType": "SettlementClassId"
                  },
                  {
                    "name": "payoffModuleId",
                    "type": "bytes32",
                    "internalType": "AdapterId"
                  },
                  {
                    "name": "payoffModuleVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "requiredAdapterKindId",
                    "type": "bytes32",
                    "internalType": "AdapterKindId"
                  },
                  {
                    "name": "requiredInterfaceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "requiredCapabilityHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "termsSchemaHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "maxFixingSlots",
                    "type": "uint16",
                    "internalType": "uint16"
                  },
                  {
                    "name": "maxTermsBytes",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "maxEvaluationGas",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "lifecyclePolicyHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "qualificationEvidenceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              },
              {
                "name": "definitionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "versionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "version",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum RegistryStatus"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "instrumentCount",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isLifecycleEnabled",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isOpenForNewRisk",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "latestVersion",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pauseInstrument",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "registerInstrument",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct InstrumentDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "instrumentKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "payoffFamilyId",
                "type": "bytes32",
                "internalType": "PayoffFamilyId"
              },
              {
                "name": "settlementClassId",
                "type": "bytes32",
                "internalType": "SettlementClassId"
              },
              {
                "name": "payoffModuleId",
                "type": "bytes32",
                "internalType": "AdapterId"
              },
              {
                "name": "payoffModuleVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "requiredAdapterKindId",
                "type": "bytes32",
                "internalType": "AdapterKindId"
              },
              {
                "name": "requiredInterfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredCapabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "termsSchemaHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxFixingSlots",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "maxTermsBytes",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "maxEvaluationGas",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "lifecyclePolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "statusOf",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "InstrumentActiveVersionChanged",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "InstrumentId"
          },
          {
            "name": "previousVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "newVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "InstrumentRegistered",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "versionHash",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "definition",
            "type": "tuple",
            "indexed": false,
            "internalType": "struct InstrumentDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "instrumentKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "payoffFamilyId",
                "type": "bytes32",
                "internalType": "PayoffFamilyId"
              },
              {
                "name": "settlementClassId",
                "type": "bytes32",
                "internalType": "SettlementClassId"
              },
              {
                "name": "payoffModuleId",
                "type": "bytes32",
                "internalType": "AdapterId"
              },
              {
                "name": "payoffModuleVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "requiredAdapterKindId",
                "type": "bytes32",
                "internalType": "AdapterKindId"
              },
              {
                "name": "requiredInterfaceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "requiredCapabilityHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "termsSchemaHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxFixingSlots",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "maxTermsBytes",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "maxEvaluationGas",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "lifecyclePolicyHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "chainId",
            "type": "uint256",
            "indexed": false,
            "internalType": "uint256"
          },
          {
            "name": "initialStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "InstrumentStatusChanged",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AdapterRegistryHasNoCode",
        "inputs": [
          {
            "name": "adapterRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AnotherInstrumentVersionActive",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "activeVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateInstrumentDefinition",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "existingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "InstrumentVersionExhausted",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidInstrumentTransition",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidMaxEvaluationGas",
        "inputs": [
          {
            "name": "maxEvaluationGas",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "hardCap",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidMaxFixingSlots",
        "inputs": [
          {
            "name": "maxFixingSlots",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidMaxTermsBytes",
        "inputs": [
          {
            "name": "maxTermsBytes",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "PayoffModuleCapabilityMismatch",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "adapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "requiredCapabilityHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actualCapabilityHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "PayoffModuleDependencyNotOpen",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "adapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "PayoffModuleInterfaceMismatch",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "adapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "requiredInterfaceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actualInterfaceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "PayoffModuleKindMismatch",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "adapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "expectedKindId",
            "type": "bytes32",
            "internalType": "AdapterKindId"
          },
          {
            "name": "actualKindId",
            "type": "bytes32",
            "internalType": "AdapterKindId"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownInstrumentVersion",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownPayoffModuleDependency",
        "inputs": [
          {
            "name": "adapterId",
            "type": "bytes32",
            "internalType": "AdapterId"
          },
          {
            "name": "adapterVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnsupportedPayoffAdapterKind",
        "inputs": [
          {
            "name": "adapterKindId",
            "type": "bytes32",
            "internalType": "AdapterKindId"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnsupportedSettlementClass",
        "inputs": [
          {
            "name": "settlementClassId",
            "type": "bytes32",
            "internalType": "SettlementClassId"
          }
        ]
      },
      {
        "type": "error",
        "name": "ZeroAdapterRegistry",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroDefinitionHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroEvaluationGasHardCap",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInstrumentCapabilityHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInstrumentInterfaceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInstrumentKey",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInstrumentNamespaceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInstrumentQualificationEvidenceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroLifecyclePolicyHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroPayoffFamilyId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroPayoffModule",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroTermsSchemaHash",
        "inputs": []
      }
    ]
  },
  "MarketRegistry": {
    "artifact": "contracts/out/MarketRegistry.sol/MarketRegistry.json",
    "sourceName": "src/registry/MarketRegistry.sol",
    "contractName": "MarketRegistry",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "assetRegistry_",
            "type": "address",
            "internalType": "contract IAssetRegistry"
          },
          {
            "name": "settlementAssetRegistry_",
            "type": "address",
            "internalType": "contract ISettlementAssetRegistry"
          },
          {
            "name": "collateralVault_",
            "type": "address",
            "internalType": "contract ICollateralVault"
          },
          {
            "name": "benchmarkRegistry_",
            "type": "address",
            "internalType": "contract IBenchmarkRegistry"
          },
          {
            "name": "calendarRegistry_",
            "type": "address",
            "internalType": "contract ICalendarRegistry"
          },
          {
            "name": "sessionRegistry_",
            "type": "address",
            "internalType": "contract ISessionRegistry"
          },
          {
            "name": "riskDomainRegistry_",
            "type": "address",
            "internalType": "contract IRiskDomainRegistry"
          },
          {
            "name": "feeScheduleRegistry_",
            "type": "address",
            "internalType": "contract IFeeScheduleRegistry"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "MARKET_QUALIFIER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "MARKET_STATUS_MANAGER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activateMarket",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activeVersion",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "assetRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IAssetRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "benchmarkRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IBenchmarkRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "calendarRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract ICalendarRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "collateralVault",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract ICollateralVault"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deprecateMarket",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "deriveMarketId",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct MarketDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marketKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "baseAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "quoteAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "settlementAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "settlementAssetVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "markBenchmarkId",
                "type": "bytes32",
                "internalType": "BenchmarkId"
              },
              {
                "name": "markBenchmarkVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "tradingCalendarId",
                "type": "bytes32",
                "internalType": "CalendarId"
              },
              {
                "name": "tradingCalendarVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "tradingSessionId",
                "type": "bytes32",
                "internalType": "SessionId"
              },
              {
                "name": "tradingSessionVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "riskDomainId",
                "type": "bytes32",
                "internalType": "RiskDomainId"
              },
              {
                "name": "riskDomainVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "feeScheduleId",
                "type": "bytes32",
                "internalType": "FeeScheduleId"
              },
              {
                "name": "feeScheduleVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "quoteUnitId",
                "type": "bytes32",
                "internalType": "QuoteUnitId"
              },
              {
                "name": "tickSizeMinor",
                "type": "uint128",
                "internalType": "TickSizeMinor"
              },
              {
                "name": "lotStep",
                "type": "uint128",
                "internalType": "Lots"
              },
              {
                "name": "minOrderLots",
                "type": "uint128",
                "internalType": "Lots"
              },
              {
                "name": "maxOrderLots",
                "type": "uint128",
                "internalType": "Lots"
              },
              {
                "name": "minPriceTicks",
                "type": "int128",
                "internalType": "PriceTicks"
              },
              {
                "name": "maxPriceTicks",
                "type": "int128",
                "internalType": "PriceTicks"
              },
              {
                "name": "executionModeSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "MarketId"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "exists",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "feeScheduleRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IFeeScheduleRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getMarket",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "tuple",
            "internalType": "struct MarketVersion",
            "components": [
              {
                "name": "definition",
                "type": "tuple",
                "internalType": "struct MarketDefinition",
                "components": [
                  {
                    "name": "namespaceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "marketKey",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "baseAssetId",
                    "type": "bytes32",
                    "internalType": "AssetId"
                  },
                  {
                    "name": "quoteAssetId",
                    "type": "bytes32",
                    "internalType": "AssetId"
                  },
                  {
                    "name": "settlementAssetId",
                    "type": "bytes32",
                    "internalType": "AssetId"
                  },
                  {
                    "name": "settlementAssetVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "markBenchmarkId",
                    "type": "bytes32",
                    "internalType": "BenchmarkId"
                  },
                  {
                    "name": "markBenchmarkVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "tradingCalendarId",
                    "type": "bytes32",
                    "internalType": "CalendarId"
                  },
                  {
                    "name": "tradingCalendarVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "tradingSessionId",
                    "type": "bytes32",
                    "internalType": "SessionId"
                  },
                  {
                    "name": "tradingSessionVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "riskDomainId",
                    "type": "bytes32",
                    "internalType": "RiskDomainId"
                  },
                  {
                    "name": "riskDomainVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "feeScheduleId",
                    "type": "bytes32",
                    "internalType": "FeeScheduleId"
                  },
                  {
                    "name": "feeScheduleVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "quoteUnitId",
                    "type": "bytes32",
                    "internalType": "QuoteUnitId"
                  },
                  {
                    "name": "tickSizeMinor",
                    "type": "uint128",
                    "internalType": "TickSizeMinor"
                  },
                  {
                    "name": "lotStep",
                    "type": "uint128",
                    "internalType": "Lots"
                  },
                  {
                    "name": "minOrderLots",
                    "type": "uint128",
                    "internalType": "Lots"
                  },
                  {
                    "name": "maxOrderLots",
                    "type": "uint128",
                    "internalType": "Lots"
                  },
                  {
                    "name": "minPriceTicks",
                    "type": "int128",
                    "internalType": "PriceTicks"
                  },
                  {
                    "name": "maxPriceTicks",
                    "type": "int128",
                    "internalType": "PriceTicks"
                  },
                  {
                    "name": "executionModeSetHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "qualificationEvidenceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              },
              {
                "name": "definitionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "versionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "version",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum RegistryStatus"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isLifecycleEnabled",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isOpenForNewRisk",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "latestVersion",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "marketCount",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pauseMarket",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "registerMarket",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct MarketDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marketKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "baseAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "quoteAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "settlementAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "settlementAssetVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "markBenchmarkId",
                "type": "bytes32",
                "internalType": "BenchmarkId"
              },
              {
                "name": "markBenchmarkVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "tradingCalendarId",
                "type": "bytes32",
                "internalType": "CalendarId"
              },
              {
                "name": "tradingCalendarVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "tradingSessionId",
                "type": "bytes32",
                "internalType": "SessionId"
              },
              {
                "name": "tradingSessionVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "riskDomainId",
                "type": "bytes32",
                "internalType": "RiskDomainId"
              },
              {
                "name": "riskDomainVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "feeScheduleId",
                "type": "bytes32",
                "internalType": "FeeScheduleId"
              },
              {
                "name": "feeScheduleVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "quoteUnitId",
                "type": "bytes32",
                "internalType": "QuoteUnitId"
              },
              {
                "name": "tickSizeMinor",
                "type": "uint128",
                "internalType": "TickSizeMinor"
              },
              {
                "name": "lotStep",
                "type": "uint128",
                "internalType": "Lots"
              },
              {
                "name": "minOrderLots",
                "type": "uint128",
                "internalType": "Lots"
              },
              {
                "name": "maxOrderLots",
                "type": "uint128",
                "internalType": "Lots"
              },
              {
                "name": "minPriceTicks",
                "type": "int128",
                "internalType": "PriceTicks"
              },
              {
                "name": "maxPriceTicks",
                "type": "int128",
                "internalType": "PriceTicks"
              },
              {
                "name": "executionModeSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "riskDomainRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IRiskDomainRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "sessionRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract ISessionRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "settlementAssetRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract ISettlementAssetRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "statusOf",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "MarketActiveVersionChanged",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "MarketId"
          },
          {
            "name": "previousVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "newVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "MarketRegistered",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "versionHash",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "definition",
            "type": "tuple",
            "indexed": false,
            "internalType": "struct MarketDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marketKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "baseAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "quoteAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "settlementAssetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "settlementAssetVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "markBenchmarkId",
                "type": "bytes32",
                "internalType": "BenchmarkId"
              },
              {
                "name": "markBenchmarkVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "tradingCalendarId",
                "type": "bytes32",
                "internalType": "CalendarId"
              },
              {
                "name": "tradingCalendarVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "tradingSessionId",
                "type": "bytes32",
                "internalType": "SessionId"
              },
              {
                "name": "tradingSessionVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "riskDomainId",
                "type": "bytes32",
                "internalType": "RiskDomainId"
              },
              {
                "name": "riskDomainVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "feeScheduleId",
                "type": "bytes32",
                "internalType": "FeeScheduleId"
              },
              {
                "name": "feeScheduleVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "quoteUnitId",
                "type": "bytes32",
                "internalType": "QuoteUnitId"
              },
              {
                "name": "tickSizeMinor",
                "type": "uint128",
                "internalType": "TickSizeMinor"
              },
              {
                "name": "lotStep",
                "type": "uint128",
                "internalType": "Lots"
              },
              {
                "name": "minOrderLots",
                "type": "uint128",
                "internalType": "Lots"
              },
              {
                "name": "maxOrderLots",
                "type": "uint128",
                "internalType": "Lots"
              },
              {
                "name": "minPriceTicks",
                "type": "int128",
                "internalType": "PriceTicks"
              },
              {
                "name": "maxPriceTicks",
                "type": "int128",
                "internalType": "PriceTicks"
              },
              {
                "name": "executionModeSetHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "chainId",
            "type": "uint256",
            "indexed": false,
            "internalType": "uint256"
          },
          {
            "name": "initialStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "MarketStatusChanged",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AnotherMarketVersionActive",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "activeVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AssetDependencyNotActive",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "BenchmarkDependencyNotOpen",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "BenchmarkPairMismatch",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "CalendarDependencyNotOpen",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "DependencyGraphMismatch",
        "inputs": [
          {
            "name": "expectedRegistry",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "actualRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateMarketDefinition",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "existingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "FeeScheduleDependencyNotOpen",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "FeeScheduleSettlementMismatch",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "IdenticalMarketAssets",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidMarketLotBounds",
        "inputs": [
          {
            "name": "lotStep",
            "type": "uint128",
            "internalType": "Lots"
          },
          {
            "name": "minOrderLots",
            "type": "uint128",
            "internalType": "Lots"
          },
          {
            "name": "maxOrderLots",
            "type": "uint128",
            "internalType": "Lots"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidMarketPriceBounds",
        "inputs": [
          {
            "name": "minPriceTicks",
            "type": "int128",
            "internalType": "PriceTicks"
          },
          {
            "name": "maxPriceTicks",
            "type": "int128",
            "internalType": "PriceTicks"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidMarketTransition",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "MarketVersionExhausted",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          }
        ]
      },
      {
        "type": "error",
        "name": "RegistryDependencyHasNoCode",
        "inputs": [
          {
            "name": "dependency",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "RiskDomainDependencyNotOpen",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "RiskDomainSettlementMismatch",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "SessionCalendarMismatch",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "SessionDependencyNotOpen",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "SettlementAssetDependencyNotOpen",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "SettlementAssetMustEqualQuoteAsset",
        "inputs": [
          {
            "name": "quoteAssetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "settlementAssetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ]
      },
      {
        "type": "error",
        "name": "TerminalReservationCapabilityMismatch",
        "inputs": [
          {
            "name": "required",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "actual",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "TerminalReservationCapabilityNotSupported",
        "inputs": [
          {
            "name": "required",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownAssetDependency",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownBenchmarkDependency",
        "inputs": [
          {
            "name": "benchmarkId",
            "type": "bytes32",
            "internalType": "BenchmarkId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownCalendarDependency",
        "inputs": [
          {
            "name": "calendarId",
            "type": "bytes32",
            "internalType": "CalendarId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownFeeScheduleDependency",
        "inputs": [
          {
            "name": "feeScheduleId",
            "type": "bytes32",
            "internalType": "FeeScheduleId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownMarketVersion",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownRiskDomainDependency",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownSessionDependency",
        "inputs": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "SessionId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownSettlementAssetDependency",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnsupportedQuoteUnit",
        "inputs": [
          {
            "name": "quoteUnitId",
            "type": "bytes32",
            "internalType": "QuoteUnitId"
          }
        ]
      },
      {
        "type": "error",
        "name": "ZeroDefinitionHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroExecutionModeSetHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMarketAssetId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMarketDependencyVersion",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMarketKey",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMarketLotBound",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMarketNamespaceId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMarketQualificationEvidenceHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMarketTickSize",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRegistryDependency",
        "inputs": []
      }
    ]
  },
  "SeriesRegistry": {
    "artifact": "contracts/out/SeriesRegistry.sol/SeriesRegistry.json",
    "sourceName": "src/registry/SeriesRegistry.sol",
    "contractName": "SeriesRegistry",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "marketRegistry_",
            "type": "address",
            "internalType": "contract IMarketRegistry"
          },
          {
            "name": "instrumentRegistry_",
            "type": "address",
            "internalType": "contract IInstrumentRegistry"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "SERIES_QUALIFIER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "SERIES_STATUS_MANAGER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activateSeries",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "qualification",
            "type": "tuple",
            "internalType": "struct SeriesQualificationData",
            "components": [
              {
                "name": "payoffTerms",
                "type": "bytes",
                "internalType": "bytes"
              },
              {
                "name": "fixingSlots",
                "type": "tuple[]",
                "internalType": "struct FixingSlot[]",
                "components": [
                  {
                    "name": "slot",
                    "type": "uint8",
                    "internalType": "uint8"
                  },
                  {
                    "name": "candidates",
                    "type": "tuple[]",
                    "internalType": "struct FixingCandidate[]",
                    "components": [
                      {
                        "name": "benchmarkId",
                        "type": "bytes32",
                        "internalType": "BenchmarkId"
                      },
                      {
                        "name": "benchmarkVersion",
                        "type": "uint32",
                        "internalType": "uint32"
                      },
                      {
                        "name": "requiredWindowKindId",
                        "type": "bytes32",
                        "internalType": "WindowKindId"
                      },
                      {
                        "name": "selectionRuleId",
                        "type": "bytes32",
                        "internalType": "FixingSelectionRuleId"
                      },
                      {
                        "name": "targetAt",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "windowStartsAt",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "windowEndsAt",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "unavailableAfter",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "maxPublicationLagSeconds",
                        "type": "uint32",
                        "internalType": "uint32"
                      },
                      {
                        "name": "minimumObservations",
                        "type": "uint16",
                        "internalType": "uint16"
                      },
                      {
                        "name": "maximumObservations",
                        "type": "uint16",
                        "internalType": "uint16"
                      },
                      {
                        "name": "selectionParametersHash",
                        "type": "bytes32",
                        "internalType": "bytes32"
                      }
                    ]
                  }
                ]
              },
              {
                "name": "dateProofs",
                "type": "tuple[]",
                "internalType": "struct SeriesDateProof[]",
                "components": [
                  {
                    "name": "kind",
                    "type": "uint8",
                    "internalType": "enum SeriesDateKind"
                  },
                  {
                    "name": "conventionId",
                    "type": "bytes32",
                    "internalType": "DateAdjustmentConventionId"
                  },
                  {
                    "name": "scheduledDay",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "calendarDays",
                    "type": "tuple[]",
                    "internalType": "struct CalendarDayProof[]",
                    "components": [
                      {
                        "name": "calendarDay",
                        "type": "tuple",
                        "internalType": "struct CalendarDay",
                        "components": [
                          {
                            "name": "day",
                            "type": "uint32",
                            "internalType": "uint32"
                          },
                          {
                            "name": "isBusinessDay",
                            "type": "bool",
                            "internalType": "bool"
                          },
                          {
                            "name": "evidenceHash",
                            "type": "bytes32",
                            "internalType": "bytes32"
                          }
                        ]
                      },
                      {
                        "name": "merkleProof",
                        "type": "bytes32[]",
                        "internalType": "bytes32[]"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "activeVersion",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deprecateSeries",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "deriveSeriesId",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct SeriesDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "seriesKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marketId",
                "type": "bytes32",
                "internalType": "MarketId"
              },
              {
                "name": "marketVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "instrumentId",
                "type": "bytes32",
                "internalType": "InstrumentId"
              },
              {
                "name": "instrumentVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "tradingStartsAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "lastTradingAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "expiryAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exerciseOpensAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exerciseCutoffAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "fixingWindowOpen",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "fixingWindowClose",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "primaryEvidenceDeadline",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "correctionCutoffAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "finalResolutionAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "settlementDeadline",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exercisePolicyId",
                "type": "bytes32",
                "internalType": "ExercisePolicyId"
              },
              {
                "name": "disruptionOutcomeId",
                "type": "bytes32",
                "internalType": "DisruptionOutcomeId"
              },
              {
                "name": "terminalDisruptionTransferMinorPerLot",
                "type": "int256",
                "internalType": "int256"
              },
              {
                "name": "payoffTermsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "fixingSlotsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "dateAdjustmentEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxLongDebitMinorPerLot",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxShortDebitMinorPerLot",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "SeriesId"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "exists",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getSeries",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "tuple",
            "internalType": "struct SeriesVersion",
            "components": [
              {
                "name": "definition",
                "type": "tuple",
                "internalType": "struct SeriesDefinition",
                "components": [
                  {
                    "name": "namespaceId",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "seriesKey",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "marketId",
                    "type": "bytes32",
                    "internalType": "MarketId"
                  },
                  {
                    "name": "marketVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "instrumentId",
                    "type": "bytes32",
                    "internalType": "InstrumentId"
                  },
                  {
                    "name": "instrumentVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "tradingStartsAt",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "lastTradingAt",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "expiryAt",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "exerciseOpensAt",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "exerciseCutoffAt",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "fixingWindowOpen",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "fixingWindowClose",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "primaryEvidenceDeadline",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "correctionCutoffAt",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "finalResolutionAt",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "settlementDeadline",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "exercisePolicyId",
                    "type": "bytes32",
                    "internalType": "ExercisePolicyId"
                  },
                  {
                    "name": "disruptionOutcomeId",
                    "type": "bytes32",
                    "internalType": "DisruptionOutcomeId"
                  },
                  {
                    "name": "terminalDisruptionTransferMinorPerLot",
                    "type": "int256",
                    "internalType": "int256"
                  },
                  {
                    "name": "payoffTermsHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "fixingSlotsHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "dateAdjustmentEvidenceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  },
                  {
                    "name": "maxLongDebitMinorPerLot",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "maxShortDebitMinorPerLot",
                    "type": "uint128",
                    "internalType": "uint128"
                  },
                  {
                    "name": "qualificationEvidenceHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              },
              {
                "name": "definitionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "versionHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "version",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum RegistryStatus"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "hashDateProofs",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct SeriesDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "seriesKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marketId",
                "type": "bytes32",
                "internalType": "MarketId"
              },
              {
                "name": "marketVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "instrumentId",
                "type": "bytes32",
                "internalType": "InstrumentId"
              },
              {
                "name": "instrumentVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "tradingStartsAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "lastTradingAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "expiryAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exerciseOpensAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exerciseCutoffAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "fixingWindowOpen",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "fixingWindowClose",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "primaryEvidenceDeadline",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "correctionCutoffAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "finalResolutionAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "settlementDeadline",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exercisePolicyId",
                "type": "bytes32",
                "internalType": "ExercisePolicyId"
              },
              {
                "name": "disruptionOutcomeId",
                "type": "bytes32",
                "internalType": "DisruptionOutcomeId"
              },
              {
                "name": "terminalDisruptionTransferMinorPerLot",
                "type": "int256",
                "internalType": "int256"
              },
              {
                "name": "payoffTermsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "fixingSlotsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "dateAdjustmentEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxLongDebitMinorPerLot",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxShortDebitMinorPerLot",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "dateProofs",
            "type": "tuple[]",
            "internalType": "struct SeriesDateProof[]",
            "components": [
              {
                "name": "kind",
                "type": "uint8",
                "internalType": "enum SeriesDateKind"
              },
              {
                "name": "conventionId",
                "type": "bytes32",
                "internalType": "DateAdjustmentConventionId"
              },
              {
                "name": "scheduledDay",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "calendarDays",
                "type": "tuple[]",
                "internalType": "struct CalendarDayProof[]",
                "components": [
                  {
                    "name": "calendarDay",
                    "type": "tuple",
                    "internalType": "struct CalendarDay",
                    "components": [
                      {
                        "name": "day",
                        "type": "uint32",
                        "internalType": "uint32"
                      },
                      {
                        "name": "isBusinessDay",
                        "type": "bool",
                        "internalType": "bool"
                      },
                      {
                        "name": "evidenceHash",
                        "type": "bytes32",
                        "internalType": "bytes32"
                      }
                    ]
                  },
                  {
                    "name": "merkleProof",
                    "type": "bytes32[]",
                    "internalType": "bytes32[]"
                  }
                ]
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "hashFixingSlots",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct SeriesDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "seriesKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marketId",
                "type": "bytes32",
                "internalType": "MarketId"
              },
              {
                "name": "marketVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "instrumentId",
                "type": "bytes32",
                "internalType": "InstrumentId"
              },
              {
                "name": "instrumentVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "tradingStartsAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "lastTradingAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "expiryAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exerciseOpensAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exerciseCutoffAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "fixingWindowOpen",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "fixingWindowClose",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "primaryEvidenceDeadline",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "correctionCutoffAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "finalResolutionAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "settlementDeadline",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exercisePolicyId",
                "type": "bytes32",
                "internalType": "ExercisePolicyId"
              },
              {
                "name": "disruptionOutcomeId",
                "type": "bytes32",
                "internalType": "DisruptionOutcomeId"
              },
              {
                "name": "terminalDisruptionTransferMinorPerLot",
                "type": "int256",
                "internalType": "int256"
              },
              {
                "name": "payoffTermsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "fixingSlotsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "dateAdjustmentEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxLongDebitMinorPerLot",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxShortDebitMinorPerLot",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "slots",
            "type": "tuple[]",
            "internalType": "struct FixingSlot[]",
            "components": [
              {
                "name": "slot",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "candidates",
                "type": "tuple[]",
                "internalType": "struct FixingCandidate[]",
                "components": [
                  {
                    "name": "benchmarkId",
                    "type": "bytes32",
                    "internalType": "BenchmarkId"
                  },
                  {
                    "name": "benchmarkVersion",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "requiredWindowKindId",
                    "type": "bytes32",
                    "internalType": "WindowKindId"
                  },
                  {
                    "name": "selectionRuleId",
                    "type": "bytes32",
                    "internalType": "FixingSelectionRuleId"
                  },
                  {
                    "name": "targetAt",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "windowStartsAt",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "windowEndsAt",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "unavailableAfter",
                    "type": "uint64",
                    "internalType": "uint64"
                  },
                  {
                    "name": "maxPublicationLagSeconds",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "minimumObservations",
                    "type": "uint16",
                    "internalType": "uint16"
                  },
                  {
                    "name": "maximumObservations",
                    "type": "uint16",
                    "internalType": "uint16"
                  },
                  {
                    "name": "selectionParametersHash",
                    "type": "bytes32",
                    "internalType": "bytes32"
                  }
                ]
              }
            ]
          },
          {
            "name": "maximumSlots",
            "type": "uint16",
            "internalType": "uint16"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "hashPayoffTerms",
        "inputs": [
          {
            "name": "termsSchemaHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "terms",
            "type": "bytes",
            "internalType": "bytes"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "instrumentRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IInstrumentRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isLifecycleEnabled",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isOpenForNewRisk",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "latestVersion",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "marketRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IMarketRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pauseSeries",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "registerSeries",
        "inputs": [
          {
            "name": "definition",
            "type": "tuple",
            "internalType": "struct SeriesDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "seriesKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marketId",
                "type": "bytes32",
                "internalType": "MarketId"
              },
              {
                "name": "marketVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "instrumentId",
                "type": "bytes32",
                "internalType": "InstrumentId"
              },
              {
                "name": "instrumentVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "tradingStartsAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "lastTradingAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "expiryAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exerciseOpensAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exerciseCutoffAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "fixingWindowOpen",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "fixingWindowClose",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "primaryEvidenceDeadline",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "correctionCutoffAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "finalResolutionAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "settlementDeadline",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exercisePolicyId",
                "type": "bytes32",
                "internalType": "ExercisePolicyId"
              },
              {
                "name": "disruptionOutcomeId",
                "type": "bytes32",
                "internalType": "DisruptionOutcomeId"
              },
              {
                "name": "terminalDisruptionTransferMinorPerLot",
                "type": "int256",
                "internalType": "int256"
              },
              {
                "name": "payoffTermsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "fixingSlotsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "dateAdjustmentEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxLongDebitMinorPerLot",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxShortDebitMinorPerLot",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "qualification",
            "type": "tuple",
            "internalType": "struct SeriesQualificationData",
            "components": [
              {
                "name": "payoffTerms",
                "type": "bytes",
                "internalType": "bytes"
              },
              {
                "name": "fixingSlots",
                "type": "tuple[]",
                "internalType": "struct FixingSlot[]",
                "components": [
                  {
                    "name": "slot",
                    "type": "uint8",
                    "internalType": "uint8"
                  },
                  {
                    "name": "candidates",
                    "type": "tuple[]",
                    "internalType": "struct FixingCandidate[]",
                    "components": [
                      {
                        "name": "benchmarkId",
                        "type": "bytes32",
                        "internalType": "BenchmarkId"
                      },
                      {
                        "name": "benchmarkVersion",
                        "type": "uint32",
                        "internalType": "uint32"
                      },
                      {
                        "name": "requiredWindowKindId",
                        "type": "bytes32",
                        "internalType": "WindowKindId"
                      },
                      {
                        "name": "selectionRuleId",
                        "type": "bytes32",
                        "internalType": "FixingSelectionRuleId"
                      },
                      {
                        "name": "targetAt",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "windowStartsAt",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "windowEndsAt",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "unavailableAfter",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "maxPublicationLagSeconds",
                        "type": "uint32",
                        "internalType": "uint32"
                      },
                      {
                        "name": "minimumObservations",
                        "type": "uint16",
                        "internalType": "uint16"
                      },
                      {
                        "name": "maximumObservations",
                        "type": "uint16",
                        "internalType": "uint16"
                      },
                      {
                        "name": "selectionParametersHash",
                        "type": "bytes32",
                        "internalType": "bytes32"
                      }
                    ]
                  }
                ]
              },
              {
                "name": "dateProofs",
                "type": "tuple[]",
                "internalType": "struct SeriesDateProof[]",
                "components": [
                  {
                    "name": "kind",
                    "type": "uint8",
                    "internalType": "enum SeriesDateKind"
                  },
                  {
                    "name": "conventionId",
                    "type": "bytes32",
                    "internalType": "DateAdjustmentConventionId"
                  },
                  {
                    "name": "scheduledDay",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "calendarDays",
                    "type": "tuple[]",
                    "internalType": "struct CalendarDayProof[]",
                    "components": [
                      {
                        "name": "calendarDay",
                        "type": "tuple",
                        "internalType": "struct CalendarDay",
                        "components": [
                          {
                            "name": "day",
                            "type": "uint32",
                            "internalType": "uint32"
                          },
                          {
                            "name": "isBusinessDay",
                            "type": "bool",
                            "internalType": "bool"
                          },
                          {
                            "name": "evidenceHash",
                            "type": "bytes32",
                            "internalType": "bytes32"
                          }
                        ]
                      },
                      {
                        "name": "merkleProof",
                        "type": "bytes32[]",
                        "internalType": "bytes32[]"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        "outputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "seriesCount",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "statusOf",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "SeriesActiveVersionChanged",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "SeriesId"
          },
          {
            "name": "previousVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "newVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "SeriesQualificationPublished",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "qualification",
            "type": "tuple",
            "indexed": false,
            "internalType": "struct SeriesQualificationData",
            "components": [
              {
                "name": "payoffTerms",
                "type": "bytes",
                "internalType": "bytes"
              },
              {
                "name": "fixingSlots",
                "type": "tuple[]",
                "internalType": "struct FixingSlot[]",
                "components": [
                  {
                    "name": "slot",
                    "type": "uint8",
                    "internalType": "uint8"
                  },
                  {
                    "name": "candidates",
                    "type": "tuple[]",
                    "internalType": "struct FixingCandidate[]",
                    "components": [
                      {
                        "name": "benchmarkId",
                        "type": "bytes32",
                        "internalType": "BenchmarkId"
                      },
                      {
                        "name": "benchmarkVersion",
                        "type": "uint32",
                        "internalType": "uint32"
                      },
                      {
                        "name": "requiredWindowKindId",
                        "type": "bytes32",
                        "internalType": "WindowKindId"
                      },
                      {
                        "name": "selectionRuleId",
                        "type": "bytes32",
                        "internalType": "FixingSelectionRuleId"
                      },
                      {
                        "name": "targetAt",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "windowStartsAt",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "windowEndsAt",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "unavailableAfter",
                        "type": "uint64",
                        "internalType": "uint64"
                      },
                      {
                        "name": "maxPublicationLagSeconds",
                        "type": "uint32",
                        "internalType": "uint32"
                      },
                      {
                        "name": "minimumObservations",
                        "type": "uint16",
                        "internalType": "uint16"
                      },
                      {
                        "name": "maximumObservations",
                        "type": "uint16",
                        "internalType": "uint16"
                      },
                      {
                        "name": "selectionParametersHash",
                        "type": "bytes32",
                        "internalType": "bytes32"
                      }
                    ]
                  }
                ]
              },
              {
                "name": "dateProofs",
                "type": "tuple[]",
                "internalType": "struct SeriesDateProof[]",
                "components": [
                  {
                    "name": "kind",
                    "type": "uint8",
                    "internalType": "enum SeriesDateKind"
                  },
                  {
                    "name": "conventionId",
                    "type": "bytes32",
                    "internalType": "DateAdjustmentConventionId"
                  },
                  {
                    "name": "scheduledDay",
                    "type": "uint32",
                    "internalType": "uint32"
                  },
                  {
                    "name": "calendarDays",
                    "type": "tuple[]",
                    "internalType": "struct CalendarDayProof[]",
                    "components": [
                      {
                        "name": "calendarDay",
                        "type": "tuple",
                        "internalType": "struct CalendarDay",
                        "components": [
                          {
                            "name": "day",
                            "type": "uint32",
                            "internalType": "uint32"
                          },
                          {
                            "name": "isBusinessDay",
                            "type": "bool",
                            "internalType": "bool"
                          },
                          {
                            "name": "evidenceHash",
                            "type": "bytes32",
                            "internalType": "bytes32"
                          }
                        ]
                      },
                      {
                        "name": "merkleProof",
                        "type": "bytes32[]",
                        "internalType": "bytes32[]"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "SeriesRegistered",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "versionHash",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "definition",
            "type": "tuple",
            "indexed": false,
            "internalType": "struct SeriesDefinition",
            "components": [
              {
                "name": "namespaceId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "seriesKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "marketId",
                "type": "bytes32",
                "internalType": "MarketId"
              },
              {
                "name": "marketVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "instrumentId",
                "type": "bytes32",
                "internalType": "InstrumentId"
              },
              {
                "name": "instrumentVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "tradingStartsAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "lastTradingAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "expiryAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exerciseOpensAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exerciseCutoffAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "fixingWindowOpen",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "fixingWindowClose",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "primaryEvidenceDeadline",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "correctionCutoffAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "finalResolutionAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "settlementDeadline",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "exercisePolicyId",
                "type": "bytes32",
                "internalType": "ExercisePolicyId"
              },
              {
                "name": "disruptionOutcomeId",
                "type": "bytes32",
                "internalType": "DisruptionOutcomeId"
              },
              {
                "name": "terminalDisruptionTransferMinorPerLot",
                "type": "int256",
                "internalType": "int256"
              },
              {
                "name": "payoffTermsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "fixingSlotsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "dateAdjustmentEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "maxLongDebitMinorPerLot",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "maxShortDebitMinorPerLot",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "qualificationEvidenceHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "chainId",
            "type": "uint256",
            "indexed": false,
            "internalType": "uint256"
          },
          {
            "name": "initialStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "SeriesStatusChanged",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "indexed": true,
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AnotherSeriesVersionActive",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "activeVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "BenchmarkCandidateHorizonTooNarrow",
        "inputs": [
          {
            "name": "slot",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "candidate",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "BenchmarkCandidateNotOpen",
        "inputs": [
          {
            "name": "slot",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "candidate",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "BenchmarkCandidatePairMismatch",
        "inputs": [
          {
            "name": "slot",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "candidate",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "CalendarDateHorizonTooNarrow",
        "inputs": [
          {
            "name": "dateIndex",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "CalendarDateNotOpen",
        "inputs": [
          {
            "name": "dateIndex",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "DateAdjustmentEvidenceHashMismatch",
        "inputs": [
          {
            "name": "expected",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actual",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateFixingCandidate",
        "inputs": [
          {
            "name": "slot",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "first",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "second",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "DuplicateSeriesDefinition",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "definitionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "existingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "EmptyPayoffTerms",
        "inputs": []
      },
      {
        "type": "error",
        "name": "FixingSlotsHashMismatch",
        "inputs": [
          {
            "name": "expected",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actual",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "InstrumentDependencyNotOpen",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "InstrumentDependencyRecordMismatch",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidAutomaticExerciseWindow",
        "inputs": [
          {
            "name": "exerciseOpensAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "exerciseCutoffAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidCalendarDayProof",
        "inputs": [
          {
            "name": "dateIndex",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "dayIndex",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidDateAdjustmentDays",
        "inputs": [
          {
            "name": "index",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidDateProofCount",
        "inputs": [
          {
            "name": "count",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidDateProofKind",
        "inputs": [
          {
            "name": "index",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expected",
            "type": "uint8",
            "internalType": "enum SeriesDateKind"
          },
          {
            "name": "actual",
            "type": "uint8",
            "internalType": "enum SeriesDateKind"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidElectionExerciseWindow",
        "inputs": [
          {
            "name": "expiryAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "exerciseOpensAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "exerciseCutoffAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidFixingCandidate",
        "inputs": [
          {
            "name": "slot",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "candidate",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidFixingCandidateCount",
        "inputs": [
          {
            "name": "slot",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "count",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maximum",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidFixingSlotCount",
        "inputs": [
          {
            "name": "count",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maximum",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidFixingSlotIndex",
        "inputs": [
          {
            "name": "index",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "actual",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidFlatDisruptionTransfer",
        "inputs": [
          {
            "name": "terminalDisruptionTransferMinorPerLot",
            "type": "int256",
            "internalType": "int256"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidPayoffModuleReturn",
        "inputs": [
          {
            "name": "selector",
            "type": "bytes4",
            "internalType": "bytes4"
          },
          {
            "name": "length",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidSeriesFixingTimeline",
        "inputs": []
      },
      {
        "type": "error",
        "name": "InvalidSeriesTradingWindow",
        "inputs": [
          {
            "name": "tradingStartsAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "lastTradingAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidSeriesTransition",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "previousStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "internalType": "enum RegistryStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "MarketDependencyNotOpen",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "MarketDependencyRecordMismatch",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "MerkleProofTooLong",
        "inputs": [
          {
            "name": "dateIndex",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "dayIndex",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "length",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "PayoffDebitBoundsMismatch",
        "inputs": [
          {
            "name": "expectedLong",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "actualLong",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "expectedShort",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "actualShort",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "PayoffDisruptionTransferMismatch",
        "inputs": [
          {
            "name": "expected",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "actual",
            "type": "int256",
            "internalType": "int256"
          }
        ]
      },
      {
        "type": "error",
        "name": "PayoffDisruptionTransferOutsideBounds",
        "inputs": [
          {
            "name": "transfer",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "maxLongDebit",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxShortDebit",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "PayoffFamilyMismatch",
        "inputs": [
          {
            "name": "expected",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actual",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "PayoffModuleCallFailed",
        "inputs": [
          {
            "name": "selector",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ]
      },
      {
        "type": "error",
        "name": "PayoffModuleRuntimeMismatch",
        "inputs": []
      },
      {
        "type": "error",
        "name": "PayoffTermsHashMismatch",
        "inputs": [
          {
            "name": "expected",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actual",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "PayoffTermsTooLarge",
        "inputs": [
          {
            "name": "length",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maximum",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "RegistryDependencyHasNoCode",
        "inputs": [
          {
            "name": "dependency",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "RiskDomainRecordMismatch",
        "inputs": []
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "SeriesLiabilityExceedsRiskCap",
        "inputs": [
          {
            "name": "liability",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "accountCap",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "aggregateCap",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "SeriesTradingEnded",
        "inputs": [
          {
            "name": "lastTradingAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "currentTimestamp",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "SeriesVersionExhausted",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          }
        ]
      },
      {
        "type": "error",
        "name": "SessionDateHorizonTooNarrow",
        "inputs": [
          {
            "name": "dateIndex",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "SessionDateNotOpen",
        "inputs": [
          {
            "name": "dateIndex",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "day",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "TerminalDisruptionTransferOutsideBounds",
        "inputs": [
          {
            "name": "terminalDisruptionTransferMinorPerLot",
            "type": "int256",
            "internalType": "int256"
          },
          {
            "name": "maxLongDebitMinorPerLot",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxShortDebitMinorPerLot",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownBenchmarkCandidate",
        "inputs": [
          {
            "name": "slot",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "candidate",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownInstrumentDependency",
        "inputs": [
          {
            "name": "instrumentId",
            "type": "bytes32",
            "internalType": "InstrumentId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownMarketDependency",
        "inputs": [
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "MarketId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownSeriesVersion",
        "inputs": [
          {
            "name": "seriesId",
            "type": "bytes32",
            "internalType": "SeriesId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnsupportedDateAdjustmentConvention",
        "inputs": [
          {
            "name": "conventionId",
            "type": "bytes32",
            "internalType": "DateAdjustmentConventionId"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnsupportedDisruptionOutcome",
        "inputs": [
          {
            "name": "disruptionOutcomeId",
            "type": "bytes32",
            "internalType": "DisruptionOutcomeId"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnsupportedExercisePolicy",
        "inputs": [
          {
            "name": "exercisePolicyId",
            "type": "bytes32",
            "internalType": "ExercisePolicyId"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnsupportedFixingSelectionRule",
        "inputs": [
          {
            "name": "slot",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "candidate",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "selectionRuleId",
            "type": "bytes32",
            "internalType": "FixingSelectionRuleId"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnsupportedFixingWindowKind",
        "inputs": [
          {
            "name": "slot",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "candidate",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "ZeroDefinitionHash",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRegistryDependency",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSeriesCommitment",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSeriesDebitBounds",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSeriesDependency",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSeriesKey",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSeriesNamespaceId",
        "inputs": []
      }
    ]
  },
  "CollateralVault": {
    "artifact": "contracts/out/CollateralVault.sol/CollateralVault.json",
    "sourceName": "src/collateral/CollateralVault.sol",
    "contractName": "CollateralVault",
    "abi": [
      {
        "type": "constructor",
        "inputs": [
          {
            "name": "defaultAdminDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "initialAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "settlementAssetRegistry_",
            "type": "address",
            "internalType": "contract ISettlementAssetRegistry"
          },
          {
            "name": "riskDomainRegistry_",
            "type": "address",
            "internalType": "contract IRiskDomainRegistry"
          },
          {
            "name": "maxLockDuration_",
            "type": "uint64",
            "internalType": "uint64"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "COLLATERAL_LOCKER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "COLLATERAL_SETTLER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "DEFAULT_ADMIN_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "EXCESS_RECOVERY_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "POSITION_ENGINE_TERMINAL_STATE_INTERFACE_VERSION",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "TERMINAL_RESERVATION_CAPABILITY_VERSION",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "TERMINAL_RESERVATION_CREATOR_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "TERMINAL_RESERVATION_RESOLVER_ROLE",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "acceptController",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "acceptDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "accountExists",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "accountRiskDomainTerminalLiability",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "balanceOf",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "internalType": "CollateralId"
          }
        ],
        "outputs": [
          {
            "name": "total",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "locked",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "available",
            "type": "uint128",
            "internalType": "uint128"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "beginDefaultAdminTransfer",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "cancelControllerProposal",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "cancelDefaultAdminTransfer",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "changeDefaultAdminDelay",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "collateralEncumbrance",
        "inputs": [
          {
            "name": "collateralId",
            "type": "bytes32",
            "internalType": "CollateralId"
          }
        ],
        "outputs": [
          {
            "name": "preTradeLocked",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "terminalReserved",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "terminalClaimBacking",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "collateralLiability",
        "inputs": [
          {
            "name": "collateralId",
            "type": "bytes32",
            "internalType": "CollateralId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "consumeLock",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          },
          {
            "name": "recipientAccountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "convertLockToTerminalLiabilityReservation",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          },
          {
            "name": "positionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "riskDomainVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ],
        "outputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "createAccount",
        "inputs": [
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "createLock",
        "inputs": [
          {
            "name": "lockReference",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "settlementOperator",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "createTerminalLiabilityReservation",
        "inputs": [
          {
            "name": "positionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "payerAccountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "riskDomainVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "positionEngine",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "defaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "defaultAdminDelayIncreaseWait",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deposit",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "deriveAccountId",
        "inputs": [
          {
            "name": "creator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deriveCollateralId",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "CollateralId"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deriveLockId",
        "inputs": [
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "lockReference",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deriveTerminalClaimId",
        "inputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          },
          {
            "name": "terminalOutcomeReference",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "TerminalClaimId"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "deriveTerminalLiabilityReservationId",
        "inputs": [
          {
            "name": "positionEngine",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "positionEngineId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "positionId",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "encumbranceOf",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "internalType": "CollateralId"
          }
        ],
        "outputs": [
          {
            "name": "preTradeLocked",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "terminalReserved",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "terminalClaimBacking",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "totalLocked",
            "type": "uint128",
            "internalType": "uint128"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "excessOf",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "finalizeTerminalLiabilityReservation",
        "inputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          }
        ],
        "outputs": [
          {
            "name": "claimId",
            "type": "bytes32",
            "internalType": "TerminalClaimId"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "fulfillTerminalClaim",
        "inputs": [
          {
            "name": "claimId",
            "type": "bytes32",
            "internalType": "TerminalClaimId"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "getAccount",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ],
        "outputs": [
          {
            "name": "controller",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "pendingController",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getLock",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "tuple",
            "internalType": "struct CollateralLock",
            "components": [
              {
                "name": "accountId",
                "type": "bytes32",
                "internalType": "AccountId"
              },
              {
                "name": "collateralId",
                "type": "bytes32",
                "internalType": "CollateralId"
              },
              {
                "name": "assetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "lockReference",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "operator",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "bindingVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "expiry",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "settlementOperator",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum LockStatus"
              },
              {
                "name": "initialAmount",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "remainingAmount",
                "type": "uint128",
                "internalType": "uint128"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "getRoleAdmin",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "grantRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "hasRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isLockOperator",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "isSolvent",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "lockOperatorEpoch",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint64",
            "internalType": "uint64"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "lockStatusOf",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum LockStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "materializeTerminalClaimAfterFinalResolution",
        "inputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          }
        ],
        "outputs": [
          {
            "name": "claimId",
            "type": "bytes32",
            "internalType": "TerminalClaimId"
          }
        ],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "maxLockDuration",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint64",
            "internalType": "uint64"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "address"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdmin",
        "inputs": [],
        "outputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "pendingDefaultAdminDelay",
        "inputs": [],
        "outputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "proposeController",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "newController",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "recoverExcess",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "reentrancyCheck",
        "inputs": [],
        "outputs": [],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "releaseExpiredLock",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "releaseLock",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "renounceRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "revokeRole",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "riskDomainRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract IRiskDomainRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "riskDomainTerminalLiability",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "rollbackDefaultAdminDelay",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "setLockOperator",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "approved",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "settlementAssetRegistry",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "address",
            "internalType": "contract ISettlementAssetRegistry"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [
          {
            "name": "interfaceId",
            "type": "bytes4",
            "internalType": "bytes4"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "supportsTerminalReservationCapability",
        "inputs": [
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "bool",
            "internalType": "bool"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "terminalClaimOf",
        "inputs": [
          {
            "name": "claimId",
            "type": "bytes32",
            "internalType": "TerminalClaimId"
          }
        ],
        "outputs": [
          {
            "name": "claim",
            "type": "tuple",
            "internalType": "struct TerminalClaim",
            "components": [
              {
                "name": "reservationId",
                "type": "bytes32",
                "internalType": "TerminalLiabilityReservationId"
              },
              {
                "name": "positionId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "payerAccountId",
                "type": "bytes32",
                "internalType": "AccountId"
              },
              {
                "name": "receiverAccountId",
                "type": "bytes32",
                "internalType": "AccountId"
              },
              {
                "name": "collateralId",
                "type": "bytes32",
                "internalType": "CollateralId"
              },
              {
                "name": "riskDomainId",
                "type": "bytes32",
                "internalType": "RiskDomainId"
              },
              {
                "name": "terminalOutcomeReference",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum TerminalClaimStatus"
              },
              {
                "name": "riskDomainVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "amount",
                "type": "uint128",
                "internalType": "uint128"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "terminalClaimStatusOf",
        "inputs": [
          {
            "name": "claimId",
            "type": "bytes32",
            "internalType": "TerminalClaimId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum TerminalClaimStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "terminalLiabilityReservationOf",
        "inputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          }
        ],
        "outputs": [
          {
            "name": "reservation",
            "type": "tuple",
            "internalType": "struct TerminalLiabilityReservation",
            "components": [
              {
                "name": "positionId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "positionEngineId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "positionEngineCodeHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "payerAccountId",
                "type": "bytes32",
                "internalType": "AccountId"
              },
              {
                "name": "collateralId",
                "type": "bytes32",
                "internalType": "CollateralId"
              },
              {
                "name": "assetId",
                "type": "bytes32",
                "internalType": "AssetId"
              },
              {
                "name": "riskDomainId",
                "type": "bytes32",
                "internalType": "RiskDomainId"
              },
              {
                "name": "creator",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "positionEngine",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "terminalOutcomeReference",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "terminalAccountId",
                "type": "bytes32",
                "internalType": "AccountId"
              },
              {
                "name": "bindingVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "riskDomainVersion",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "settlementDeadline",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "finalResolutionAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum TerminalLiabilityReservationStatus"
              },
              {
                "name": "terminalOutcome",
                "type": "uint8",
                "internalType": "enum TerminalOutcomeKind"
              },
              {
                "name": "initialAmount",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "remainingAmount",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "terminalAmount",
                "type": "uint128",
                "internalType": "uint128"
              }
            ]
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "terminalLiabilityReservationStatusOf",
        "inputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint8",
            "internalType": "enum TerminalLiabilityReservationStatus"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "terminalReservationCapabilityVersion",
        "inputs": [],
        "outputs": [
          {
            "name": "",
            "type": "uint32",
            "internalType": "uint32"
          }
        ],
        "stateMutability": "pure"
      },
      {
        "type": "function",
        "name": "tokenBalance",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "tokenLiability",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [
          {
            "name": "",
            "type": "uint256",
            "internalType": "uint256"
          }
        ],
        "stateMutability": "view"
      },
      {
        "type": "function",
        "name": "transferAvailable",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "fromAccountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "toAccountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "function",
        "name": "withdraw",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
      },
      {
        "type": "event",
        "name": "AccountControlProposalCancelled",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "controller",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "cancelledController",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "AccountControlProposed",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "controller",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "pendingController",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "AccountControlTransferred",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "previousController",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "newController",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "newLockOperatorEpoch",
            "type": "uint64",
            "indexed": false,
            "internalType": "uint64"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "AccountCreated",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "controller",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "CollateralDeposited",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CollateralId"
          },
          {
            "name": "token",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "assetId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "payer",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "newTotal",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "CollateralLockConsumed",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CollateralLockId"
          },
          {
            "name": "payerAccountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "recipientAccountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "CollateralId"
          },
          {
            "name": "amount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "remainingAmount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum LockStatus"
          },
          {
            "name": "settler",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "CollateralLockConverted",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CollateralLockId"
          },
          {
            "name": "reservationId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "TerminalLiabilityReservationId"
          },
          {
            "name": "payerAccountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "CollateralId"
          },
          {
            "name": "convertedAmount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "remainingAmount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum LockStatus"
          },
          {
            "name": "creator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "CollateralLockCreated",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CollateralLockId"
          },
          {
            "name": "accountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CollateralId"
          },
          {
            "name": "lockReference",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "assetId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          },
          {
            "name": "settlementOperator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "indexed": false,
            "internalType": "uint64"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "CollateralLockReleased",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CollateralLockId"
          },
          {
            "name": "accountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CollateralId"
          },
          {
            "name": "releasedAmount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum LockStatus"
          },
          {
            "name": "caller",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "CollateralTransferred",
        "inputs": [
          {
            "name": "fromAccountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "toAccountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CollateralId"
          },
          {
            "name": "amount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "newFromTotal",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "newToTotal",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "controller",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "CollateralWithdrawn",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "CollateralId"
          },
          {
            "name": "token",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "assetId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "controller",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "newTotal",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminDelayChangeScheduled",
        "inputs": [
          {
            "name": "newDelay",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          },
          {
            "name": "effectSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferCanceled",
        "inputs": [],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "DefaultAdminTransferScheduled",
        "inputs": [
          {
            "name": "newAdmin",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "acceptSchedule",
            "type": "uint48",
            "indexed": false,
            "internalType": "uint48"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "ExcessRecovered",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AssetId"
          },
          {
            "name": "token",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "amount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "tokenLiability",
            "type": "uint256",
            "indexed": false,
            "internalType": "uint256"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "LockOperatorSet",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "operator",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "approved",
            "type": "bool",
            "indexed": false,
            "internalType": "bool"
          },
          {
            "name": "epoch",
            "type": "uint64",
            "indexed": false,
            "internalType": "uint64"
          },
          {
            "name": "controller",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleAdminChanged",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "previousAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "newAdminRole",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleGranted",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "RoleRevoked",
        "inputs": [
          {
            "name": "role",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          },
          {
            "name": "sender",
            "type": "address",
            "indexed": true,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "TerminalClaimCreated",
        "inputs": [
          {
            "name": "claimId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "TerminalClaimId"
          },
          {
            "name": "reservationId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "TerminalLiabilityReservationId"
          },
          {
            "name": "positionId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "payerAccountId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "AccountId"
          },
          {
            "name": "receiverAccountId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "CollateralId"
          },
          {
            "name": "terminalOutcomeReference",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "amount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "TerminalClaimFulfilled",
        "inputs": [
          {
            "name": "claimId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "TerminalClaimId"
          },
          {
            "name": "reservationId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "TerminalLiabilityReservationId"
          },
          {
            "name": "receiverAccountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "payerAccountId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "CollateralId"
          },
          {
            "name": "amount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "caller",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "TerminalLiabilityReservationCreated",
        "inputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "TerminalLiabilityReservationId"
          },
          {
            "name": "positionId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "payerAccountId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "CollateralId"
          },
          {
            "name": "assetId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "AssetId"
          },
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "RiskDomainId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "riskDomainVersion",
            "type": "uint32",
            "indexed": false,
            "internalType": "uint32"
          },
          {
            "name": "creator",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          },
          {
            "name": "positionEngine",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          },
          {
            "name": "positionEngineId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "positionEngineCodeHash",
            "type": "bytes32",
            "indexed": false,
            "internalType": "bytes32"
          },
          {
            "name": "amount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "settlementDeadline",
            "type": "uint64",
            "indexed": false,
            "internalType": "uint64"
          },
          {
            "name": "finalResolutionAt",
            "type": "uint64",
            "indexed": false,
            "internalType": "uint64"
          },
          {
            "name": "sourceLockId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "CollateralLockId"
          }
        ],
        "anonymous": false
      },
      {
        "type": "event",
        "name": "TerminalLiabilityReservationResolved",
        "inputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "TerminalLiabilityReservationId"
          },
          {
            "name": "positionId",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "terminalOutcomeReference",
            "type": "bytes32",
            "indexed": true,
            "internalType": "bytes32"
          },
          {
            "name": "payerAccountId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "AccountId"
          },
          {
            "name": "terminalAccountId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "indexed": false,
            "internalType": "CollateralId"
          },
          {
            "name": "terminalAmount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "releasedAmount",
            "type": "uint128",
            "indexed": false,
            "internalType": "uint128"
          },
          {
            "name": "terminalOutcome",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum TerminalOutcomeKind"
          },
          {
            "name": "newStatus",
            "type": "uint8",
            "indexed": false,
            "internalType": "enum TerminalLiabilityReservationStatus"
          },
          {
            "name": "caller",
            "type": "address",
            "indexed": false,
            "internalType": "address"
          }
        ],
        "anonymous": false
      },
      {
        "type": "error",
        "name": "AccessControlBadConfirmation",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminDelay",
        "inputs": [
          {
            "name": "schedule",
            "type": "uint48",
            "internalType": "uint48"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlEnforcedDefaultAdminRules",
        "inputs": []
      },
      {
        "type": "error",
        "name": "AccessControlInvalidDefaultAdmin",
        "inputs": [
          {
            "name": "defaultAdmin",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccessControlUnauthorizedAccount",
        "inputs": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "neededRole",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccountAlreadyExists",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ]
      },
      {
        "type": "error",
        "name": "AccountTerminalLiabilityCapExceeded",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "cap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "requested",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "AggregateTerminalLiabilityCapExceeded",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "cap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "requested",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "AmountAboveLockRemaining",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          },
          {
            "name": "remaining",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "requested",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "AmountAboveTerminalLiabilityReservation",
        "inputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          },
          {
            "name": "remaining",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "requested",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "BalanceOverflow",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "internalType": "CollateralId"
          },
          {
            "name": "current",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "BindingClosedForNewRisk",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "ControllerUnchanged",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "controller",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "InexactDepositReceipt",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "balanceBefore",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "balanceAfter",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "InexactTransferSettlement",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "InsufficientAvailable",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "collateralId",
            "type": "bytes32",
            "internalType": "CollateralId"
          },
          {
            "name": "available",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "requested",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "InsufficientExcess",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenBalance",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "tokenLiability",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "requested",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidLockExpiry",
        "inputs": [
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "nowTs",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "maxExpiry",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidPositionDeadlines",
        "inputs": [
          {
            "name": "settlementDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "finalResolutionAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "nowTs",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "type": "error",
        "name": "InvalidTerminalState",
        "inputs": [
          {
            "name": "outcome",
            "type": "uint8",
            "internalType": "enum TerminalOutcomeKind"
          },
          {
            "name": "receiverAccountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "amount",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "type": "error",
        "name": "LockAlreadyExists",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          }
        ]
      },
      {
        "type": "error",
        "name": "LockExpired",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "type": "error",
        "name": "LockNotActive",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum LockStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "LockNotExpired",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "type": "error",
        "name": "LockOperatorEpochExhausted",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ]
      },
      {
        "type": "error",
        "name": "LockOperatorNotApproved",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "LockOperatorNotAuthorized",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "NoPendingController",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ]
      },
      {
        "type": "error",
        "name": "NotAccountController",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "caller",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "NotLockOperator",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          },
          {
            "name": "caller",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "NotLockSettlementOperator",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          },
          {
            "name": "pinnedSettlementOperator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "caller",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "NotPendingController",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          },
          {
            "name": "caller",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "PositionAlreadyTerminal",
        "inputs": [
          {
            "name": "positionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "outcome",
            "type": "uint8",
            "internalType": "enum TerminalOutcomeKind"
          }
        ]
      },
      {
        "type": "error",
        "name": "PositionDeadlinesChanged",
        "inputs": [
          {
            "name": "requiredSettlementDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "actualSettlementDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "requiredFinalResolutionAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "actualFinalResolutionAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "type": "error",
        "name": "PositionEngineCodeChanged",
        "inputs": [
          {
            "name": "positionEngine",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "required",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actual",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "PositionEngineHasNoCode",
        "inputs": [
          {
            "name": "positionEngine",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "PositionEngineIdentityChanged",
        "inputs": [
          {
            "name": "positionEngine",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "required",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actual",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "PositionEngineInterfaceVersionMismatch",
        "inputs": [
          {
            "name": "positionEngine",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "required",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "actual",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "PositionEngineNotAuthorized",
        "inputs": [
          {
            "name": "positionEngine",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "PositionNotTerminal",
        "inputs": [
          {
            "name": "positionId",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "PositionStateMismatch",
        "inputs": [
          {
            "name": "requiredPositionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "actualPositionId",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "type": "error",
        "name": "ReentrancyGuardReentrantCall",
        "inputs": []
      },
      {
        "type": "error",
        "name": "RiskDomainCollateralMismatch",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "expectedAssetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "expectedBindingVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "actualAssetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "actualBindingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "RiskDomainNotOpenForNewRisk",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "RiskDomainRegistryHasNoCode",
        "inputs": [
          {
            "name": "riskDomainRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "RiskDomainSettlementRegistryMismatch",
        "inputs": [
          {
            "name": "expected",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "actual",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeCastOverflowedUintDowncast",
        "inputs": [
          {
            "name": "bits",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "type": "error",
        "name": "SafeERC20FailedOperation",
        "inputs": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "SelfConsumption",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ]
      },
      {
        "type": "error",
        "name": "SelfTransfer",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ]
      },
      {
        "type": "error",
        "name": "SettlementAssetRegistryHasNoCode",
        "inputs": [
          {
            "name": "settlementAssetRegistry",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "SettlementOperatorNotAuthorized",
        "inputs": [
          {
            "name": "settlementOperator",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "TerminalClaimAlreadyExists",
        "inputs": [
          {
            "name": "claimId",
            "type": "bytes32",
            "internalType": "TerminalClaimId"
          }
        ]
      },
      {
        "type": "error",
        "name": "TerminalClaimFallbackNotReached",
        "inputs": [
          {
            "name": "finalResolutionAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "nowTs",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "type": "error",
        "name": "TerminalClaimNotActive",
        "inputs": [
          {
            "name": "claimId",
            "type": "bytes32",
            "internalType": "TerminalClaimId"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum TerminalClaimStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "TerminalLiabilityReservationAlreadyExists",
        "inputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          }
        ]
      },
      {
        "type": "error",
        "name": "TerminalLiabilityReservationNotActive",
        "inputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum TerminalLiabilityReservationStatus"
          }
        ]
      },
      {
        "type": "error",
        "name": "TerminalReservationsDisabled",
        "inputs": [
          {
            "name": "riskDomainId",
            "type": "bytes32",
            "internalType": "RiskDomainId"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownAccount",
        "inputs": [
          {
            "name": "accountId",
            "type": "bytes32",
            "internalType": "AccountId"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownBindingVersion",
        "inputs": [
          {
            "name": "assetId",
            "type": "bytes32",
            "internalType": "AssetId"
          },
          {
            "name": "bindingVersion",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownLock",
        "inputs": [
          {
            "name": "lockId",
            "type": "bytes32",
            "internalType": "CollateralLockId"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownTerminalClaim",
        "inputs": [
          {
            "name": "claimId",
            "type": "bytes32",
            "internalType": "TerminalClaimId"
          }
        ]
      },
      {
        "type": "error",
        "name": "UnknownTerminalLiabilityReservation",
        "inputs": [
          {
            "name": "reservationId",
            "type": "bytes32",
            "internalType": "TerminalLiabilityReservationId"
          }
        ]
      },
      {
        "type": "error",
        "name": "VaultRecipient",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroAmount",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroController",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroInitialAdmin",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroLockOperator",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroLockReference",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroMaxLockDuration",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroPositionEngineId",
        "inputs": [
          {
            "name": "positionEngine",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "type": "error",
        "name": "ZeroPositionId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRecipient",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainId",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainRegistry",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroRiskDomainVersion",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSettlementAssetRegistry",
        "inputs": []
      },
      {
        "type": "error",
        "name": "ZeroSettlementOperator",
        "inputs": []
      }
    ]
  }
} as const satisfies Record<string, InternalContractBinding>;
