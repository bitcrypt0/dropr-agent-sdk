import type { ethers } from "ethers";

// ─── Pool Types ───

export type PoolType =
  | "whitelist"
  | "native-giveaway"
  | "erc20-giveaway"
  | "nft-drop"
  | "lucky-sale"
  | "pot-prize";

export interface PoolCreateParams {
  poolType: PoolType;
  name: string;
  startTime: number;
  durationMinutes: number;
  maxSlots: number;
  numberOfWinners: number;
  maxSlotsPerAddress?: number;
  slotFee?: string;
  description?: string;

  // Prize config (type-dependent)
  prizeCollectionAddress?: string;
  prizeTokenId?: number;
  nativePrizeAmount?: string;
  erc20PrizeToken?: string;
  erc20PrizeAmount?: string;

  // Social engagement
  socialEngagement?: boolean;
  socialTasks?: SocialTask[];

  // Token-gated access
  tokenGatedEnabled?: boolean;
  holderTokenAddress?: string;
  holderTokenStandard?: number;
  minHolderTokenBalance?: number;
  holderTokenId?: number;

  // Pot prize
  isPotPrize?: boolean;

  // Metadata links
  twitterLink?: string;
  discordLink?: string;
  telegramLink?: string;
}

export interface SocialTask {
  platform: "twitter" | "discord" | "telegram";
  action: string;
  target: string;
}

export interface PoolFilters {
  chainId?: number;
  creator?: string;
  state?: number | number[];
  isPrized?: boolean;
  socialEngagementRequired?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface PoolData {
  address: string;
  chainId: number;
  name: string;
  creator: string;
  stateNum: number;
  state: string;
  startTime: number;
  duration: number;
  slotFee: string;
  maxSlots: number;
  slotsSold: number;
  numberOfWinners: number;
  winnersSelected: number;
  maxSlotsPerAddress: number;
  isPrized: boolean;
  prizeCollection: string;
  prizeTokenId: number;
  nativePrizeAmount: string;
  erc20PrizeToken: string;
  erc20PrizeAmount: string;
  socialEngagementRequired: boolean;
  holderTokenAddress: string;
  usesCustomFee: boolean;
  isRefundable: boolean;
  isPotPrize: boolean;
  description: string;
  imageUrl: string | null;
}

export interface UserPoolState {
  slotsPurchased: number;
  totalSpent: string;
  winsCount: number;
  refundClaimed: boolean;
  isWinner: boolean;
  prizeClaimed: boolean;
  refundableAmount: string;
}

export interface PoolEligibility {
  canPerform: boolean;
  reason?: string;
}

export interface RandomnessEligibility extends PoolEligibility {
  isMultiBatch: boolean;
  remaining: number;
}

// ─── Collection Types ───

export interface CollectionDeployParams {
  standard: 0 | 1; // 0 = ERC721, 1 = ERC1155
  name: string;
  symbol: string;
  baseURI: string;
  dropURI: string;
  initialOwner: string;
  royaltyBps: number;
  royaltyRecipient: string;
  maxSupply: number;
  revealType: 0 | 1; // 0 = instant, 1 = delayed
  unrevealedURI?: string;
  revealTime?: number;
  description?: string;
}

export interface CollectionInfo {
  address: string;
  chainId: number;
  creator: string;
  standard: number;
  name: string;
  symbol: string;
  description: string;
  baseUri: string;
  dropUri: string;
  unrevealedUri: string;
  dropUriHash: string;
  unrevealedUriHash: string;
  isRevealed: boolean;
  maxSupply: number;
  creatorAllocation: number;
  currentSupply: number;
  isExternal: boolean;
  vestingCliffEnd: number | null;
  vestingNumUnlocks: number | null;
  vestingDurationBetweenUnlocks: number | null;
}

export interface KOLDetails {
  isApproved: boolean;
  poolLimit: number;
  feeWei: string;
  winnerLimit: number;
}

// ─── Rewards Types ───

export interface PointsSystemInfo {
  chainId: number;
  isActive: boolean;
  claimsActive: boolean;
  rewardToken: string;
  pointsPerToken: string;
  totalDeposited: string;
  cooldownPeriod: number;
}

export interface UserPointsInfo {
  userAddress: string;
  chainId: number;
  totalPoints: string;
  claimedPoints: string;
  lastClaimTime: number;
}

export interface PoolRewardInfo {
  poolAddress: string;
  depositor: string;
  rewardToken: string;
  totalDeposited: string;
  totalClaimed: string;
  rewardPerSlot: string;
  totalEligibleSlots: number;
  claimedSlots: number;
}

export interface CreatorRewardConfig {
  rewardToken: string;
  tokenSymbol: string;
  tokenDecimals: number;
  rewardAmountPerCreator: string;
  totalDeposited: string;
  totalClaimed: string;
  isActive: boolean;
}

// ─── Revenue Types ───

export interface RevenueSummary {
  pools: RevenuePool[];
  totalCalculated: string;
  totalWithdrawn: string;
  totalWithdrawable: string;
}

export interface RevenuePool {
  poolAddress: string;
  poolName: string | null;
  chainId: number;
  calculatedAmount: string;
  withdrawnAmount: string;
  withdrawableAmount: string;
  state: number;
}

// ─── Protocol Types ───

export interface ProtocolConfig {
  durationLimits: { min: string; max: string } | null;
  slotLimits: { minPrized: string; minNonPrized: string; max: string } | null;
  taskAssignmentsPaused: boolean;
  socialFee: string | null;
  creationFee: string | null;
  creationPaused: boolean;
  protocolFee: string | null;
}

export interface ProtocolStats {
  totalPools: number;
  totalParticipants: number;
  totalVolume: string;
  [key: string]: unknown;
}

// ─── Transaction Types ───

export interface TxResult {
  txHash: string;
}

export interface PoolCreatedResult extends TxResult {
  poolAddress: string;
}

export interface CollectionDeployedResult extends TxResult {
  collectionAddress: string;
}

export interface GasEstimate {
  gasLimit: ethers.BigNumber;
  gasPrice: ethers.BigNumber;
  estimatedCostWei: ethers.BigNumber;
}

// ─── Client Config ───

export interface AgentClientConfig {
  privateKey?: string;
  mnemonic?: string;
  hdPath?: string;
  signer?: ethers.Signer;
  provider?: ethers.providers.Provider;
  rpcUrl?: string;
  chainId: number;
  supabaseUrl: string;
  supabaseKey: string;
  agentApiKey?: string;
}

// ─── Subscription Types ───

export type Unsubscribe = () => void;

// ─── Purchase Auth Types ───

export interface PurchaseAuth {
  success: boolean;
  signature?: string;
  deadline?: number;
  expiresAt?: string;
  error?: string;
}
