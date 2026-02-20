import { ethers } from "ethers";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ERC20ABI } from "./contracts/abis";
import { AgentWallet } from "./wallet";
import { ensureERC20Approval } from "./token-approval";
import {
  extractRevertReason,
  TransactionRevertedError,
  NotEligibleError,
} from "./errors";
import type {
  PointsSystemInfo,
  UserPointsInfo,
  PoolRewardInfo,
  CreatorRewardConfig,
  TxResult,
} from "./types";

/**
 * Headless rewards service for AI agents.
 * Covers all three reward systems:
 *   System A — Points-based token rewards (RewardsFlywheel)
 *   System B — Pool-specific participant rewards (RewardsFlywheel)
 *   System C — Creator reward tokens (RewardsFlywheel)
 * Plus manual point allocation.
 */
export class RewardsService {
  private wallet: AgentWallet;
  private supabase: SupabaseClient;
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor(wallet: AgentWallet, supabaseUrl: string, supabaseKey: string) {
    this.wallet = wallet;
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: { headers: { "X-Client-Info": "dropr-agent-sdk" } },
    });
  }

  // ─── System A: Points Rewards ───

  /**
   * Get the current points system configuration from Supabase.
   */
  async getPointsSystemInfo(): Promise<PointsSystemInfo | null> {
    const chainId = this.wallet.getChainId();
    const { data, error } = await this.supabase
      .from("flywheel_points_system")
      .select("*")
      .eq("chain_id", chainId)
      .single();

    if (error || !data) return null;

    return {
      chainId: data.chain_id,
      isActive: data.is_active ?? false,
      claimsActive: data.claims_active ?? false,
      rewardToken: data.reward_token ?? ethers.constants.AddressZero,
      pointsPerToken: data.points_per_token?.toString() ?? "0",
      totalDeposited: data.total_deposited?.toString() ?? "0",
      cooldownPeriod: Number(data.cooldown_period ?? 0),
    };
  }

  /**
   * Get user points info from Supabase.
   */
  async getUserPoints(userAddress?: string): Promise<UserPointsInfo | null> {
    const addr = (userAddress ?? this.wallet.getAddress()).toLowerCase();
    const chainId = this.wallet.getChainId();

    const { data, error } = await this.supabase
      .from("flywheel_user_points")
      .select("*")
      .eq("user_address", addr)
      .eq("chain_id", chainId)
      .single();

    if (error || !data) return null;

    return {
      userAddress: data.user_address,
      chainId: data.chain_id,
      totalPoints: data.total_points?.toString() ?? "0",
      claimedPoints: data.claimed_points?.toString() ?? "0",
      lastClaimTime: Number(data.last_claim_time ?? 0),
    };
  }

  /**
   * Get claimable points reward amount from the RewardsFlywheel contract.
   */
  async getClaimablePointsReward(
    userAddress?: string
  ): Promise<{ claimablePoints: string; tokenAmount: string }> {
    const flywheel = this.wallet.getContract("rewardsFlywheel");
    const addr = userAddress ?? this.wallet.getAddress();

    try {
      const [claimable, tokenAmt] = await flywheel.getClaimablePointsReward(addr);
      return {
        claimablePoints: claimable.toString(),
        tokenAmount: tokenAmt.toString(),
      };
    } catch {
      return { claimablePoints: "0", tokenAmount: "0" };
    }
  }

  /**
   * Get time remaining until the user can claim points again.
   */
  async getTimeUntilNextClaim(userAddress?: string): Promise<number> {
    const points = await this.getUserPoints(userAddress);
    if (!points) return 0;

    const systemInfo = await this.getPointsSystemInfo();
    if (!systemInfo) return 0;

    const now = Math.floor(Date.now() / 1000);
    const nextClaimTime = points.lastClaimTime + systemInfo.cooldownPeriod;
    return Math.max(0, nextClaimTime - now);
  }

  /**
   * Claim points-based token rewards from the RewardsFlywheel.
   */
  async claimPointsRewards(): Promise<TxResult> {
    const flywheel = this.wallet.getContract("rewardsFlywheel");

    // Idempotency: check if there's anything to claim
    const { tokenAmount } = await this.getClaimablePointsReward();
    if (tokenAmount === "0") {
      throw new NotEligibleError("No points rewards to claim", "nothing_to_claim");
    }

    // Check cooldown
    const timeLeft = await this.getTimeUntilNextClaim();
    if (timeLeft > 0) {
      throw new NotEligibleError(
        `Cooldown active: ${timeLeft} seconds remaining`,
        "cooldown_active"
      );
    }

    try {
      await flywheel.callStatic.claimPointsRewards();
    } catch (err) {
      throw new TransactionRevertedError(
        `Claim points rewards would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await flywheel.claimPointsRewards();
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── System B: Pool-Specific Participant Rewards ───

  /**
   * Deposit ERC20 rewards for a pool's participants.
   */
  async depositERC20Rewards(
    poolAddress: string,
    tokenAddress: string,
    amount: string
  ): Promise<TxResult> {
    const flywheel = this.wallet.getContract("rewardsFlywheel");
    const signer = this.wallet.getSigner();

    // Resolve decimals and parse amount
    const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI, signer);
    const decimals: number = await tokenContract.decimals();
    const parsedAmount = ethers.utils.parseUnits(amount, decimals);

    // Ensure approval
    await ensureERC20Approval(tokenAddress, flywheel.address, parsedAmount, signer);

    try {
      await flywheel.callStatic.depositERC20Rewards(
        poolAddress,
        tokenAddress,
        parsedAmount
      );
    } catch (err) {
      throw new TransactionRevertedError(
        `Deposit ERC20 rewards would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await flywheel.depositERC20Rewards(
      poolAddress,
      tokenAddress,
      parsedAmount
    );
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Deposit native token rewards for a pool's participants.
   */
  async depositNativeRewards(
    poolAddress: string,
    amountEther: string
  ): Promise<TxResult> {
    const flywheel = this.wallet.getContract("rewardsFlywheel");
    const value = ethers.utils.parseEther(amountEther);

    try {
      await flywheel.callStatic.depositNativeRewards(poolAddress, { value });
    } catch (err) {
      throw new TransactionRevertedError(
        `Deposit native rewards would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await flywheel.depositNativeRewards(poolAddress, { value });
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Claim participant rewards from a pool.
   */
  async claimParticipantRewards(poolAddress: string): Promise<TxResult> {
    const flywheel = this.wallet.getContract("rewardsFlywheel");

    try {
      await flywheel.callStatic.claimRewards(poolAddress);
    } catch (err) {
      throw new TransactionRevertedError(
        `Claim participant rewards would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await flywheel.claimRewards(poolAddress);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Withdraw deposited rewards (depositor only).
   */
  async withdrawDepositedRewards(poolAddress: string): Promise<TxResult> {
    const flywheel = this.wallet.getContract("rewardsFlywheel");

    try {
      await flywheel.callStatic.withdrawDepositedRewards(poolAddress);
    } catch (err) {
      throw new TransactionRevertedError(
        `Withdraw rewards would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await flywheel.withdrawDepositedRewards(poolAddress);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Get the claimable reward amount for a user on a specific pool.
   */
  async getClaimableReward(
    poolAddress: string,
    userAddress?: string
  ): Promise<string> {
    const flywheel = this.wallet.getContract("rewardsFlywheel");
    const addr = userAddress ?? this.wallet.getAddress();

    try {
      const amount = await flywheel.getClaimableReward(poolAddress, addr);
      return amount.toString();
    } catch {
      return "0";
    }
  }

  /**
   * Get pool reward info from Supabase.
   */
  async getPoolRewardInfo(poolAddress: string): Promise<PoolRewardInfo | null> {
    const chainId = this.wallet.getChainId();
    const { data, error } = await this.supabase
      .from("flywheel_pool_rewards")
      .select("*")
      .eq("pool_address", poolAddress.toLowerCase())
      .eq("chain_id", chainId)
      .single();

    if (error || !data) return null;

    return {
      poolAddress: data.pool_address,
      depositor: data.depositor ?? "",
      rewardToken: data.reward_token ?? "",
      totalDeposited: data.total_deposited?.toString() ?? "0",
      totalClaimed: data.total_claimed?.toString() ?? "0",
      rewardPerSlot: data.reward_per_slot?.toString() ?? "0",
      totalEligibleSlots: Number(data.total_eligible_slots ?? 0),
      claimedSlots: Number(data.claimed_slots ?? 0),
    };
  }

  // ─── System C: Creator Rewards ───

  /**
   * Claim creator rewards for a specific pool and token.
   */
  async claimCreatorRewards(
    poolAddress: string,
    tokenAddress: string
  ): Promise<TxResult> {
    const flywheel = this.wallet.getContract("rewardsFlywheel");

    try {
      await flywheel.callStatic.claimCreatorRewards(poolAddress, tokenAddress);
    } catch (err) {
      throw new TransactionRevertedError(
        `Claim creator rewards would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await flywheel.claimCreatorRewards(poolAddress, tokenAddress);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Get the claimable creator reward amount for a pool and token.
   */
  async getCreatorClaimableAmount(
    poolAddress: string,
    tokenAddress: string
  ): Promise<string> {
    const flywheel = this.wallet.getContract("rewardsFlywheel");
    const addr = this.wallet.getAddress();

    try {
      const amount = await flywheel.getCreatorClaimableAmount(
        poolAddress,
        tokenAddress,
        addr
      );
      return amount.toString();
    } catch {
      return "0";
    }
  }

  /**
   * Get all active creator reward token configurations from Supabase.
   */
  async getCreatorRewardTokens(): Promise<CreatorRewardConfig[]> {
    const chainId = this.wallet.getChainId();
    const { data, error } = await this.supabase
      .from("flywheel_creator_rewards")
      .select("*")
      .eq("chain_id", chainId)
      .eq("is_active", true);

    if (error || !data) return [];

    return data.map((row: Record<string, unknown>) => ({
      rewardToken: (row.reward_token as string) ?? "",
      tokenSymbol: (row.token_symbol as string) ?? "",
      tokenDecimals: Number(row.token_decimals ?? 18),
      rewardAmountPerCreator: row.reward_amount_per_creator?.toString() ?? "0",
      totalDeposited: row.total_deposited?.toString() ?? "0",
      totalClaimed: row.total_claimed?.toString() ?? "0",
      isActive: (row.is_active as boolean) ?? false,
    }));
  }

  /**
   * Get a specific creator reward token configuration.
   */
  async getCreatorRewardConfig(
    tokenAddress: string
  ): Promise<CreatorRewardConfig | null> {
    const chainId = this.wallet.getChainId();
    const { data, error } = await this.supabase
      .from("flywheel_creator_rewards")
      .select("*")
      .eq("chain_id", chainId)
      .eq("reward_token", tokenAddress.toLowerCase())
      .single();

    if (error || !data) return null;

    return {
      rewardToken: data.reward_token ?? "",
      tokenSymbol: data.token_symbol ?? "",
      tokenDecimals: Number(data.token_decimals ?? 18),
      rewardAmountPerCreator: data.reward_amount_per_creator?.toString() ?? "0",
      totalDeposited: data.total_deposited?.toString() ?? "0",
      totalClaimed: data.total_claimed?.toString() ?? "0",
      isActive: data.is_active ?? false,
    };
  }

  // ─── Manual Point Allocation ───

  /**
   * Claim participant reward points for a pool.
   * Points are claimed by calling claimParticipantPoints() on the Pool contract directly,
   * NOT by calling allocateParticipantPoints() on the RewardsFlywheel.
   */
  async claimParticipantPoints(poolAddress: string): Promise<TxResult> {
    const poolContract = this.wallet.getPoolContract(poolAddress);

    // Idempotency: check if already claimed
    const userAddress = this.wallet.getAddress();
    const alreadyClaimed = await this.isParticipantPointsAllocated(
      poolAddress,
      userAddress
    );
    if (alreadyClaimed) {
      throw new NotEligibleError(
        "Participant points already claimed for this pool",
        "already_claimed"
      );
    }

    try {
      await poolContract.callStatic.claimParticipantPoints();
    } catch (err) {
      throw new TransactionRevertedError(
        `Claim participant points would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await poolContract.claimParticipantPoints();
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Claim creator reward points for a pool.
   * Points are claimed by calling claimCreatorPoints() on the Pool contract directly,
   * NOT by calling allocateCreatorPoints() on the RewardsFlywheel.
   */
  async claimCreatorPoints(poolAddress: string): Promise<TxResult> {
    const poolContract = this.wallet.getPoolContract(poolAddress);

    // Idempotency
    const alreadyClaimed = await this.isCreatorPointsAllocated(poolAddress);
    if (alreadyClaimed) {
      throw new NotEligibleError(
        "Creator points already claimed for this pool",
        "already_claimed"
      );
    }

    try {
      await poolContract.callStatic.claimCreatorPoints();
    } catch (err) {
      throw new TransactionRevertedError(
        `Claim creator points would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await poolContract.claimCreatorPoints();
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Check if participant points have already been allocated for a user on a pool.
   */
  async isParticipantPointsAllocated(
    poolAddress: string,
    userAddress: string
  ): Promise<boolean> {
    const chainId = this.wallet.getChainId();
    const { data } = await this.supabase
      .from("flywheel_points_allocations")
      .select("id")
      .eq("pool_address", poolAddress.toLowerCase())
      .eq("user_address", userAddress.toLowerCase())
      .eq("chain_id", chainId)
      .eq("allocation_type", "participant")
      .limit(1);

    return (data?.length ?? 0) > 0;
  }

  /**
   * Check if creator points have already been allocated for a pool.
   */
  async isCreatorPointsAllocated(poolAddress: string): Promise<boolean> {
    const chainId = this.wallet.getChainId();
    const { data } = await this.supabase
      .from("flywheel_points_allocations")
      .select("id")
      .eq("pool_address", poolAddress.toLowerCase())
      .eq("chain_id", chainId)
      .eq("allocation_type", "creator")
      .limit(1);

    return (data?.length ?? 0) > 0;
  }
}
