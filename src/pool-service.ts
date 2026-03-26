import { ethers } from "ethers";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ERC20ABI } from "./contracts/abis";
import { PoolState } from "./contracts/types";
import { AgentWallet } from "./wallet";
import { buildPoolParams } from "./pool-params";
import { approveERC20, approveERC721 } from "./token-approval";
import {
  extractRevertReason,
  TransactionRevertedError,
  PoolStateError,
  NotEligibleError,
  CreationPausedError,
} from "./errors";
import type {
  PoolCreateParams,
  PoolEligibility,
  RandomnessEligibility,
  TxResult,
  PoolCreatedResult,
  GasEstimate,
  PurchaseAuth,
} from "./types";

/**
 * Headless pool lifecycle service for AI agents.
 * Handles create, purchase, claim, refund, delete, randomness, and close operations.
 */
export class PoolService {
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

  // ─── Pool Creation ───

  /**
   * Create a new pool. Handles token approvals, param building, callStatic pre-flight,
   * transaction submission, and PoolCreated event parsing.
   */
  async createPool(params: PoolCreateParams): Promise<PoolCreatedResult> {
    const poolDeployer = this.wallet.getContract("poolDeployer");
    const signer = this.wallet.getSigner();
    const creator = this.wallet.getAddress();

    // Step 1: Handle token approvals
    let parsedERC20Amount = ethers.BigNumber.from(0);
    const spender = poolDeployer.address;

    if (params.poolType === "lucky-sale" && params.prizeCollectionAddress) {
      await approveERC721(
        params.prizeCollectionAddress,
        spender,
        String(params.prizeTokenId ?? "0"),
        signer
      );
    }

    if (params.poolType === "erc20-giveaway" && params.erc20PrizeToken) {
      const tokenContract = new ethers.Contract(params.erc20PrizeToken, ERC20ABI, signer);
      const decimals: number = await tokenContract.decimals();
      parsedERC20Amount = params.erc20PrizeAmount
        ? ethers.utils.parseUnits(params.erc20PrizeAmount, decimals)
        : ethers.BigNumber.from(0);

      await approveERC20(params.erc20PrizeToken, spender, parsedERC20Amount, signer);
    }

    // Step 2: Build params
    const txParams = buildPoolParams(params, creator, parsedERC20Amount);

    // Step 3: Calculate msg.value
    let totalValue = ethers.BigNumber.from(0);

    if (params.poolType === "native-giveaway" && params.nativePrizeAmount) {
      totalValue = totalValue.add(ethers.utils.parseEther(params.nativePrizeAmount));
    }

    if (params.socialEngagement && params.socialTasks && params.socialTasks.length > 0) {
      const socialFeePerTask: ethers.BigNumber = await poolDeployer.socialEngagementFee();
      totalValue = totalValue.add(socialFeePerTask.mul(params.socialTasks.length));
    }

    // Step 4: callStatic pre-flight
    try {
      await poolDeployer.callStatic.createPool(txParams, { value: totalValue });
    } catch (err) {
      const reason = extractRevertReason(err);
      if (reason.toLowerCase().includes("paused")) {
        throw new CreationPausedError();
      }
      throw new TransactionRevertedError(
        `Pool creation would revert: ${reason}`,
        reason
      );
    }

    // Step 5: Send transaction
    const tx = await poolDeployer.createPool(txParams, { value: totalValue });
    const receipt = await tx.wait();

    // Step 6: Parse PoolCreated event
    const poolCreatedEvent = receipt.events?.find(
      (e: { event?: string }) => e.event === "PoolCreated"
    );
    const poolAddress =
      poolCreatedEvent?.args?.pool ?? poolCreatedEvent?.args?.[0] ?? null;

    if (!poolAddress) {
      throw new Error(
        `Pool creation succeeded (tx: ${receipt.transactionHash}) but could not parse PoolCreated event`
      );
    }

    return { poolAddress, txHash: receipt.transactionHash };
  }

  // ─── Slot Purchase ───

  /**
   * Purchase slots in a pool. Determines the correct signature type
   * (social verification vs purchase authorization), obtains it,
   * runs callStatic pre-flight, then sends the transaction.
   *
   * Contract method: purchaseSlots(uint256 quantity, uint256 _deadline, bytes _signature, uint256[] _tokenIds)
   *
   * @param poolAddress - The pool contract address
   * @param slotCount - Number of slots to purchase
   * @param tokenIds - ERC721 token IDs for token-gated pools (pass [] for non-gated)
   */
  async purchaseSlots(
    poolAddress: string,
    slotCount: number,
    tokenIds: number[] = []
  ): Promise<TxResult> {
    const poolContract = this.wallet.getPoolContract(poolAddress);
    const userAddress = this.wallet.getAddress();
    const chainId = this.wallet.getChainId();

    // Determine which signature type is needed
    const socialEngagementRequired: boolean = await poolContract.socialEngagementRequired();

    let signatureToUse: string;
    let deadline: number;

    if (socialEngagementRequired) {
      // Social engagement pools → generate-signature (requires completing social tasks first)
      const auth = await this._generateSocialSignature(userAddress, poolAddress, slotCount, chainId);
      if (!auth.success || !auth.signature || !auth.deadline) {
        throw new NotEligibleError(
          `Failed to obtain social verification signature: ${auth.error}`,
          auth.error ?? "unknown"
        );
      }
      signatureToUse = auth.signature;
      deadline = auth.deadline;
    } else {
      // Non-social pools → generate-purchase-auth (anti-bot EIP-712)
      const auth = await this._generatePurchaseAuth(userAddress, poolAddress, chainId);
      if (!auth.success || !auth.signature || !auth.deadline) {
        throw new NotEligibleError(
          `Failed to obtain purchase authorization: ${auth.error}`,
          auth.error ?? "unknown"
        );
      }
      signatureToUse = auth.signature;
      deadline = auth.deadline;
    }

    // Read slot fee to compute msg.value
    const slotFee: ethers.BigNumber = await poolContract.slotFee();
    const totalValue = slotFee.mul(slotCount);

    // callStatic pre-flight
    // purchaseSlots(uint256 quantity, uint256 _deadline, bytes _signature, uint256[] _tokenIds)
    try {
      await poolContract.callStatic.purchaseSlots(
        slotCount,
        deadline,
        signatureToUse,
        tokenIds,
        { value: totalValue }
      );
    } catch (err) {
      throw new TransactionRevertedError(
        `Slot purchase would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await poolContract.purchaseSlots(
      slotCount,
      deadline,
      signatureToUse,
      tokenIds,
      { value: totalValue }
    );
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── Prize Claims ───

  /**
   * Claim prize from a pool. Auto-detects whether this is an NFT mint or a prize claim.
   */
  async claimPrize(poolAddress: string): Promise<TxResult> {
    const poolContract = this.wallet.getPoolContract(poolAddress);
    const userAddress = this.wallet.getAddress();

    // Idempotency: check if already claimed
    const alreadyClaimed = await this._isPrizeClaimed(poolAddress, userAddress);
    if (alreadyClaimed) {
      throw new NotEligibleError("Prize already claimed", "already_claimed");
    }

    // Determine if this is a mint (NFT drop) or claim (other prize types)
    // Must match frontend logic: mint() only for non-escrowed prized pools (NFT drops).
    // Escrowed prize pools (lucky-sale) have prizeCollection != 0x0 but isEscrowedPrize = true,
    // and must use claimPrize() instead of mint().
    const isPrized: boolean = await poolContract.isPrized();
    const isEscrowedPrize: boolean = await poolContract.isEscrowedPrize();
    const isMintable = isPrized && !isEscrowedPrize;

    const method = isMintable ? "mint" : "claimPrize";

    try {
      await poolContract.callStatic[method]();
    } catch (err) {
      throw new TransactionRevertedError(
        `Prize claim would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await poolContract[method]();
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // --- Refund Claims ---

  /**
   * Batch-claim slot fee refunds from multiple pools via the PoolRouter contract.
   * The PoolRouter handles individual pool failures gracefully on-chain.
   */
  async batchClaimRefunds(poolAddresses: string[]): Promise<TxResult> {
    if (poolAddresses.length === 0) {
      throw new NotEligibleError("No pool addresses provided", "no_pools");
    }

    const router = this.wallet.getContract("poolRouter");
    const userAddress = this.wallet.getAddress();

    const tx = await router.batchClaimRefunds(userAddress, poolAddresses);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }
  // ─── Pool Deletion ───

  /**
   * Check if a pool can be deleted by the current agent.
   */
  async canDeletePool(poolAddress: string): Promise<PoolEligibility> {
    const poolContract = this.wallet.getPoolContract(poolAddress);
    const userAddress = this.wallet.getAddress();

    const [creator, stateNum, usesCustomFee] = await Promise.all([
      poolContract.creator() as Promise<string>,
      poolContract.state() as Promise<number>,
      poolContract.usesCustomFee() as Promise<boolean>,
    ]);

    if (creator.toLowerCase() !== userAddress.toLowerCase()) {
      return { canPerform: false, reason: "Only the pool creator can delete" };
    }
    if (!usesCustomFee) {
      return { canPerform: false, reason: "Only custom-fee pools can be deleted" };
    }
    if (![PoolState.Pending, PoolState.Active].includes(stateNum)) {
      return {
        canPerform: false,
        reason: `Pool is in state ${stateNum}, must be Pending (0) or Active (1)`,
      };
    }
    return { canPerform: true };
  }

  /**
   * Delete a pool (creator-only, custom-fee pools only).
   */
  async deletePool(poolAddress: string): Promise<TxResult> {
    const eligibility = await this.canDeletePool(poolAddress);
    if (!eligibility.canPerform) {
      throw new NotEligibleError(
        `Cannot delete pool: ${eligibility.reason}`,
        eligibility.reason!
      );
    }

    const poolContract = this.wallet.getPoolContract(poolAddress);

    try {
      await poolContract.callStatic.deletePool();
    } catch (err) {
      throw new TransactionRevertedError(
        `Pool deletion would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await poolContract.deletePool();
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── Randomness / Winner Selection ───

  /**
   * Check if randomness can be requested for a pool.
   */
  async canRequestRandomness(poolAddress: string): Promise<RandomnessEligibility> {
    const poolContract = this.wallet.getPoolContract(poolAddress);

    const [stateNum, winnersCount, winnersSelected, slotsSold] = await Promise.all([
      poolContract.state().then((s: ethers.BigNumber) => s.toNumber ? s.toNumber() : Number(s)),
      poolContract.winnersCount().then((s: ethers.BigNumber) => s.toNumber ? s.toNumber() : Number(s)),
      poolContract.winnersSelected().then((s: ethers.BigNumber) => s.toNumber ? s.toNumber() : Number(s)),
      poolContract.totalSlotsPurchased().then((s: ethers.BigNumber) => s.toNumber ? s.toNumber() : Number(s)),
    ]);

    if (winnersSelected >= winnersCount) {
      return {
        canPerform: false,
        reason: "All winners already selected",
        isMultiBatch: false,
        remaining: 0,
      };
    }

    const validStates = [PoolState.Ended, PoolState.Drawing, PoolState.Active];
    if (!validStates.includes(stateNum)) {
      return {
        canPerform: false,
        reason: `Pool is in state ${stateNum}, must be Ended (2), Drawing (3), or Active (1, if expired)`,
        isMultiBatch: false,
        remaining: winnersCount - winnersSelected,
      };
    }

    if (slotsSold < winnersCount) {
      return {
        canPerform: false,
        reason: `Insufficient participants: ${slotsSold} sold, ${winnersCount} winners needed`,
        isMultiBatch: false,
        remaining: winnersCount - winnersSelected,
      };
    }

    const remaining = winnersCount - winnersSelected;
    return {
      canPerform: true,
      isMultiBatch: remaining > 1 && winnersSelected > 0,
      remaining,
    };
  }

  /**
   * Request randomness for winner selection.
   */
  async requestRandomness(poolAddress: string): Promise<TxResult> {
    const eligibility = await this.canRequestRandomness(poolAddress);
    if (!eligibility.canPerform) {
      throw new NotEligibleError(
        `Cannot request randomness: ${eligibility.reason}`,
        eligibility.reason!
      );
    }

    const poolContract = this.wallet.getPoolContract(poolAddress);

    try {
      await poolContract.callStatic.requestRandomness();
    } catch (err) {
      throw new TransactionRevertedError(
        `Randomness request would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await poolContract.requestRandomness();
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── Pool Close ───

  /**
   * Check if a pool can be closed (insufficient participants after expiry).
   */
  async canClosePool(poolAddress: string): Promise<PoolEligibility> {
    const poolContract = this.wallet.getPoolContract(poolAddress);

    const [stateNum, startTime, duration, slotsSold, winnersCount] = await Promise.all([
      poolContract.state().then((s: ethers.BigNumber) => s.toNumber ? s.toNumber() : Number(s)),
      poolContract.startTime().then((s: ethers.BigNumber) => s.toNumber ? s.toNumber() : Number(s)),
      poolContract.duration().then((s: ethers.BigNumber) => s.toNumber ? s.toNumber() : Number(s)),
      poolContract.totalSlotsPurchased().then((s: ethers.BigNumber) => s.toNumber ? s.toNumber() : Number(s)),
      poolContract.winnersCount().then((s: ethers.BigNumber) => s.toNumber ? s.toNumber() : Number(s)),
    ]);

    if (![PoolState.Pending, PoolState.Active].includes(stateNum)) {
      return {
        canPerform: false,
        reason: `Pool is in state ${stateNum}, must be Pending (0) or Active (1)`,
      };
    }

    const endTime = startTime + duration;
    const now = Math.floor(Date.now() / 1000);
    if (now < endTime || endTime === 0) {
      return { canPerform: false, reason: "Pool has not expired yet" };
    }

    if (slotsSold >= winnersCount) {
      return {
        canPerform: false,
        reason: `Pool has sufficient participants (${slotsSold} >= ${winnersCount}). Use requestRandomness instead.`,
      };
    }

    return { canPerform: true };
  }

  /**
   * Close a pool with insufficient participants after expiry.
   */
  async closePool(poolAddress: string): Promise<TxResult> {
    const eligibility = await this.canClosePool(poolAddress);
    if (!eligibility.canPerform) {
      throw new NotEligibleError(
        `Cannot close pool: ${eligibility.reason}`,
        eligibility.reason!
      );
    }

    const poolContract = this.wallet.getPoolContract(poolAddress);

    try {
      await poolContract.callStatic.closePool();
    } catch (err) {
      throw new TransactionRevertedError(
        `Pool close would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await poolContract.closePool();
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── Creator Revenue ───

  /**
   * Batch-withdraw creator revenue from multiple pools via the PoolRouter contract.
   * The PoolRouter handles individual pool failures gracefully on-chain.
   */
  async batchWithdrawCreatorRevenue(poolAddresses: string[]): Promise<TxResult> {
    if (poolAddresses.length === 0) {
      throw new NotEligibleError("No pool addresses provided", "no_pools");
    }

    const router = this.wallet.getContract("poolRouter");

    const tx = await router.batchWithdrawCreatorRevenue(poolAddresses);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── Gas Estimation ───

  /**
   * Estimate gas for a pool creation transaction.
   */
  async estimateCreatePoolGas(params: PoolCreateParams): Promise<GasEstimate> {
    const poolDeployer = this.wallet.getContract("poolDeployer");
    const creator = this.wallet.getAddress();
    const txParams = buildPoolParams(params, creator);

    let totalValue = ethers.BigNumber.from(0);
    if (params.poolType === "native-giveaway" && params.nativePrizeAmount) {
      totalValue = totalValue.add(ethers.utils.parseEther(params.nativePrizeAmount));
    }

    const gasLimit = await poolDeployer.estimateGas.createPool(txParams, {
      value: totalValue,
    });
    const gasPrice = await this.wallet.getProvider().getGasPrice();
    return {
      gasLimit,
      gasPrice,
      estimatedCostWei: gasLimit.mul(gasPrice),
    };
  }

  // ─── Private Helpers ───

  private async _generatePurchaseAuth(
    userAddress: string,
    poolAddress: string,
    chainId: number
  ): Promise<PurchaseAuth> {
    const url = `${this.supabaseUrl}/functions/v1/generate-purchase-auth`;
    const body = {
      user_address: userAddress.toLowerCase(),
      pool_address: poolAddress.toLowerCase(),
      chain_id: chainId,
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = (await response.json()) as {
        success?: boolean;
        signature?: string;
        deadline?: number;
        expires_at?: string;
        error?: string;
      };
      if (!data.success) {
        return { success: false, error: data.error || "Authorization failed" };
      }

      return {
        success: true,
        signature: data.signature,
        deadline: data.deadline,
        expiresAt: data.expires_at,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Purchase auth fetch failed",
      };
    }
  }

  private async _generateSocialSignature(
    userAddress: string,
    poolAddress: string,
    slotCount: number,
    chainId: number
  ): Promise<PurchaseAuth> {
    const url = `${this.supabaseUrl}/functions/v1/generate-signature`;
    const body = {
      user_address: userAddress.toLowerCase(),
      raffle_id: poolAddress.toLowerCase(),
      raffle_address: poolAddress.toLowerCase(),
      slot_count: slotCount,
      chain_id: chainId,
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = (await response.json()) as {
        success?: boolean;
        signature?: string;
        deadline?: number;
        expires_at?: string;
        error?: string;
      };
      if (!data.success) {
        return { success: false, error: data.error || "Social signature generation failed" };
      }

      return {
        success: true,
        signature: data.signature,
        deadline: data.deadline,
        expiresAt: data.expires_at,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Social signature fetch failed",
      };
    }
  }

  private async _isPrizeClaimed(poolAddress: string, userAddress: string): Promise<boolean> {
    const { data } = await this.supabase
      .from("pool_winners")
      .select("prize_claimed")
      .eq("pool_address", poolAddress.toLowerCase())
      .eq("winner_address", userAddress.toLowerCase())
      .single();

    return data?.prize_claimed === true;
  }

  private async _isRefundClaimed(poolAddress: string, userAddress: string): Promise<boolean> {
    const { data } = await this.supabase
      .from("pool_participants")
      .select("refund_claimed")
      .eq("pool_address", poolAddress.toLowerCase())
      .eq("participant_address", userAddress.toLowerCase())
      .single();

    return data?.refund_claimed === true;
  }
}
