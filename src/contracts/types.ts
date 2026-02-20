import type { ethers } from "ethers";

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ContractAddressMap {
  protocolManager: string;
  poolDeployer: string;
  revenueManager: string;
  nftFactory: string;
  socialEngagementManager: string;
  rewardsFlywheel: string;
  purchaseAuthorizer: string;
}

export interface NetworkInfo {
  name: string;
  rpcUrl: string;
  explorer: string;
  nativeCurrency: NativeCurrency;
  contractAddresses: ContractAddressMap;
}

/** Core contract call definition for batch operations */
export interface ContractCall {
  method: string;
  params?: unknown[];
}

/** Result from a batch contract call */
export type BatchCallResult = unknown[];

/** Multicall3 aggregate result */
export interface MulticallResult {
  success: boolean;
  returnData: string;
}

/** Pool state as returned by the smart contract */
export enum PoolState {
  Pending = 0,
  Active = 1,
  Ended = 2,
  Drawing = 3,
  Completed = 4,
  Deleted = 5,
  AllPrizesClaimed = 6,
  Unengaged = 7,
}

/** NFT standard enum matching the contract */
export enum NFTStandard {
  ERC721 = 0,
  ERC1155 = 1,
}

/** Map PoolState number to a human-readable label */
export function poolStateLabel(state: number, winnerCount?: number): string {
  if (state === PoolState.AllPrizesClaimed) {
    return winnerCount === 1 ? "Prize Claimed" : "All Prizes Claimed";
  }
  const labels: Record<number, string> = {
    [PoolState.Pending]: "Pending",
    [PoolState.Active]: "Active",
    [PoolState.Ended]: "Ended",
    [PoolState.Drawing]: "Drawing",
    [PoolState.Completed]: "Completed",
    [PoolState.Deleted]: "Deleted",
    [PoolState.AllPrizesClaimed]: "All Prizes Claimed",
    [PoolState.Unengaged]: "Unengaged",
  };
  return labels[state] ?? "Unknown";
}

/** On-chain pool data shape after decoding contract calls */
export interface OnChainPoolData {
  address: string;
  chainId: number;
  name: string;
  creator: string;
  startTime: number;
  duration: number;
  actualDuration?: number;
  slotFee: ethers.BigNumber;
  slotLimit: number;
  winnersCount: number;
  maxSlotsPerAddress: number;
  stateNum: number;
  state: string;
  isPrized: boolean;
  prizeCollection: string;
  prizeTokenId: number;
  erc20PrizeToken: string;
  erc20PrizeAmount: ethers.BigNumber;
  nativePrizeAmount: ethers.BigNumber;
  standard?: number;
  isEscrowedPrize?: boolean;
  isCollabPool: boolean;
  usesCustomFee: boolean;
  revenueRecipient: string;
  isExternalCollection: boolean;
  isRefundable: boolean;
  isPotPrize?: boolean;
}
