export interface AbiParameter {
  readonly name: string;
  readonly type: string;
  readonly internalType?: string;
  readonly indexed?: boolean;
  readonly components?: readonly AbiParameter[];
}

export interface AbiItem {
  readonly type: string;
  readonly name?: string;
  readonly stateMutability?: string;
  readonly anonymous?: boolean;
  readonly inputs?: readonly AbiParameter[];
  readonly outputs?: readonly AbiParameter[];
}

export interface InternalContractBinding {
  readonly artifact: string;
  readonly sourceName: string;
  readonly contractName: string;
  readonly abi: readonly AbiItem[];
}
