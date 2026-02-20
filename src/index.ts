// ─── dropr Agent SDK ───
// Headless SDK for AI agents to interact with the dropr.fun protocol.

export { DroprAgentClient } from "./client";
export { AgentWallet } from "./wallet";
export { PoolService } from "./pool-service";
export { CollectionService } from "./collection-service";
export { RewardsService } from "./rewards-service";
export { DataService } from "./data-service";

// Errors
export {
  AgentSDKError,
  InsufficientFundsError,
  PoolStateError,
  NotEligibleError,
  TransactionRevertedError,
  SignatureExpiredError,
  CreationPausedError,
  UnsupportedChainError,
  ContractNotDeployedError,
  extractRevertReason,
} from "./errors";

// Utilities
export {
  buildPoolParams,
  validatePoolParams,
  buildWhitelistParams,
  buildNativeGiveawayParams,
  buildERC20GiveawayParams,
  buildNFTDropParams,
  buildLuckySaleParams,
  buildPotPrizeParams,
  appendSharedParams,
  generateSocialTaskDescription,
} from "./pool-params";

export {
  checkERC20Allowance,
  checkERC721Approval,
  approveERC20,
  approveERC721,
  ensureERC20Approval,
} from "./token-approval";

// Types
export type {
  PoolType,
  PoolCreateParams,
  SocialTask,
  PoolFilters,
  PoolData,
  UserPoolState,
  PoolEligibility,
  RandomnessEligibility,
  CollectionDeployParams,
  CollectionInfo,
  KOLDetails,
  PointsSystemInfo,
  UserPointsInfo,
  PoolRewardInfo,
  CreatorRewardConfig,
  RevenueSummary,
  RevenuePool,
  ProtocolConfig,
  ProtocolStats,
  TxResult,
  PoolCreatedResult,
  CollectionDeployedResult,
  GasEstimate,
  AgentClientConfig,
  Unsubscribe,
  PurchaseAuth,
} from "./types";
