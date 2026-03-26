import { ethers } from "ethers";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type {
  PoolData,
  PoolFilters,
  UserPointsInfo,
  PoolRewardInfo,
  ProtocolConfig,
  ProtocolStats,
  PurchaseAuth,
  Unsubscribe,
} from "./types";
import type { CreatorRevenueSummary } from "./supabase/creator-revenues";
import type { CollectionRevenueSummary } from "./supabase/collection-revenues";

/**
 * Read-only data service for AI agents.
 * Wraps Supabase queries and Edge Functions using the backend-first strategy.
 * No on-chain calls needed for reads — all data is indexed off-chain.
 */
export class DataService {
  private supabase: SupabaseClient;
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: { headers: { "X-Client-Info": "dropr-agent-sdk" } },
    });
  }

  // ─── Pool Queries ───

  /**
   * List pools with optional filters. Returns mapped pool data from Supabase.
   */
  async listPools(filters?: PoolFilters): Promise<{ pools: PoolData[]; total: number }> {
    let query = this.supabase.from("pools").select(
      "id, address, chain_id, name, creator, state, start_time, duration, " +
      "slot_fee, slot_limit, slots_sold, winners_count, winners_selected, " +
      "is_prized, prize_collection, prize_token_id, native_prize_amount, " +
      "erc20_prize_amount, erc20_prize_token, erc20_prize_token_symbol, " +
      "uses_custom_fee, is_refundable, is_pot_prize, artwork_url, description, " +
      "social_engagement_required, holder_token_address, max_slots_per_address, " +
      "created_at",
      { count: "exact" }
    );

    if (filters?.chainId) query = query.eq("chain_id", filters.chainId);
    if (filters?.creator) query = query.eq("creator", filters.creator.toLowerCase());
    if (filters?.state !== undefined) {
      if (Array.isArray(filters.state)) {
        query = query.in("state", filters.state);
      } else {
        query = query.eq("state", filters.state);
      }
    }
    if (filters?.isPrized !== undefined) query = query.eq("is_prized", filters.isPrized);
    if (filters?.socialEngagementRequired !== undefined) {
      query = query.eq("social_engagement_required", filters.socialEngagementRequired);
    }

    const sortCol = filters?.sortBy || "created_at";
    const ascending = filters?.sortOrder === "asc";
    query = query.order(sortCol, { ascending });

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) return { pools: [], total: 0 };

    const pools = ((data || []) as unknown as Record<string, unknown>[]).map((row) => this._mapPoolRow(row));
    return { pools, total: count ?? pools.length };
  }

  /**
   * Get detailed pool data including winners, participants, and activity.
   */
  async getPoolDetails(
    poolAddress: string,
    chainId: number
  ): Promise<(PoolData & { winners: unknown[]; activities: unknown[] }) | null> {
    const addr = poolAddress.toLowerCase();

    const [poolRes, winnersRes, participantsRes, activityRes] = await Promise.all([
      this.supabase
        .from("pools")
        .select("*")
        .eq("address", addr)
        .eq("chain_id", chainId)
        .single(),
      this.supabase
        .from("pool_winners")
        .select("*")
        .eq("pool_address", addr)
        .eq("chain_id", chainId)
        .order("winner_index", { ascending: true }),
      this.supabase
        .from("pool_participants")
        .select("*")
        .eq("pool_address", addr)
        .eq("chain_id", chainId)
        .order("last_purchase_at", { ascending: false }),
      this.supabase
        .from("user_activity")
        .select("*")
        .eq("pool_address", addr)
        .eq("chain_id", chainId)
        .order("timestamp", { ascending: false }),
    ]);

    if (poolRes.error || !poolRes.data) return null;

    const pool = this._mapPoolRow(poolRes.data as Record<string, unknown>);

    const winners = (winnersRes.data || []).map((w: Record<string, unknown>) => ({
      address: w.winner_address,
      winnerIndex: w.winner_index,
      claimed: w.prize_claimed,
      claimedAt: w.prize_claimed_at,
      selectionBatch: w.selection_batch,
      mintedTokenId: w.minted_token_id,
      mintingFailed: w.minting_failed,
      selectionTxHash: w.selection_tx_hash,
    }));

    const activities = (activityRes.data || []).map((a: Record<string, unknown>) => ({
      type: a.activity_type,
      address: a.user_address,
      quantity: a.quantity,
      amount: a.amount,
      txHash: a.transaction_hash,
      timestamp: a.timestamp,
    }));

    return { ...pool, winners, activities };
  }

  /**
   * Get participants for a specific pool.
   */
  async getParticipants(
    poolAddress: string,
    chainId: number
  ): Promise<
    {
      address: string;
      slotsPurchased: number;
      totalSpent: string;
      winsCount: number;
      refundClaimed: boolean;
    }[]
  > {
    const { data } = await this.supabase
      .from("pool_participants")
      .select("*")
      .eq("pool_address", poolAddress.toLowerCase())
      .eq("chain_id", chainId)
      .order("slots_purchased", { ascending: false });

    return (data || []).map((p: Record<string, unknown>) => ({
      address: p.participant_address as string,
      slotsPurchased: Number(p.slots_purchased ?? 0),
      totalSpent: (p.total_spent as string) ?? "0",
      winsCount: Number(p.wins_count ?? 0),
      refundClaimed: (p.refund_claimed as boolean) ?? false,
    }));
  }

  /**
   * Get winners for a specific pool.
   */
  async getWinners(
    poolAddress: string,
    chainId: number
  ): Promise<
    {
      address: string;
      winnerIndex: number;
      prizeClaimed: boolean;
      mintedTokenId: number | null;
      selectionTxHash: string | null;
    }[]
  > {
    const { data } = await this.supabase
      .from("pool_winners")
      .select("*")
      .eq("pool_address", poolAddress.toLowerCase())
      .eq("chain_id", chainId)
      .order("winner_index", { ascending: true });

    return (data || []).map((w: Record<string, unknown>) => ({
      address: w.winner_address as string,
      winnerIndex: Number(w.winner_index ?? 0),
      prizeClaimed: (w.prize_claimed as boolean) ?? false,
      mintedTokenId: w.minted_token_id != null ? Number(w.minted_token_id) : null,
      selectionTxHash: (w.selection_tx_hash as string) ?? null,
    }));
  }

  // ─── Intelligent Pool Discovery ───

  /**
   * Find pools eligible for agent participation.
   * Filters out social-engagement pools and pools at capacity.
   */
  async findEligiblePools(
    chainId: number,
    options?: {
      holderTokens?: string[];
      maxResults?: number;
      sortBy?: "slot_fee" | "native_prize_amount" | "created_at";
    }
  ): Promise<PoolData[]> {
    let query = this.supabase
      .from("pools")
      .select("*")
      .eq("chain_id", chainId)
      .eq("social_engagement_required", false)
      .in("state", [0, 1]); // Pending or Active only

    const sortCol = options?.sortBy || "created_at";
    query = query.order(sortCol, { ascending: false });
    query = query.limit(options?.maxResults || 50);

    const { data, error } = await query;
    if (error || !data) return [];

    return (data as Record<string, unknown>[])
      .filter((row) => {
        // Filter out pools at capacity
        const sold = Number(row.slots_sold ?? 0);
        const max = Number(row.slot_limit ?? 0);
        if (max > 0 && sold >= max) return false;

        // If agent has holder tokens, check token-gating
        const holderAddr = row.holder_token_address as string;
        if (
          holderAddr &&
          holderAddr !== ethers.constants.AddressZero &&
          options?.holderTokens
        ) {
          const hasToken = options.holderTokens.some(
            (t) => t.toLowerCase() === holderAddr.toLowerCase()
          );
          if (!hasToken) return false;
        } else if (
          holderAddr &&
          holderAddr !== ethers.constants.AddressZero &&
          !options?.holderTokens
        ) {
          // Skip token-gated pools if no holder tokens provided
          return false;
        }

        return true;
      })
      .map((row) => this._mapPoolRow(row));
  }

  // ─── User Queries ───

  /**
   * Get user profile and stats via the api-user Edge Function.
   */
  async getUserProfile(
    walletAddress: string,
    chainId?: number
  ): Promise<unknown | null> {
    return this._callEdgeFunction("api-user", {
      address: walletAddress.toLowerCase(),
      ...(chainId ? { chainId } : {}),
    });
  }

  /**
   * Get user activity history from Supabase.
   */
  async getUserActivity(
    walletAddress: string,
    chainId?: number,
    limit = 50
  ): Promise<
    {
      type: string;
      poolAddress: string;
      poolName: string;
      quantity: number;
      amount: string;
      txHash: string;
      timestamp: string;
    }[]
  > {
    let query = this.supabase
      .from("user_activity")
      .select("*")
      .eq("user_address", walletAddress.toLowerCase())
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (chainId) query = query.eq("chain_id", chainId);

    const { data } = await query;

    return (data || []).map((a: Record<string, unknown>) => ({
      type: (a.activity_type as string) ?? "",
      poolAddress: (a.pool_address as string) ?? "",
      poolName: (a.pool_name as string) ?? "",
      quantity: Number(a.quantity ?? 0),
      amount: (a.amount as string) ?? "0",
      txHash: (a.transaction_hash as string) ?? "",
      timestamp: (a.timestamp as string) ?? "",
    }));
  }

  // ─── Collection Queries ───

  /**
   * Get collections created by a wallet address.
   */
  async getUserCollections(
    walletAddress: string,
    chainId?: number
  ): Promise<unknown[]> {
    let query = this.supabase
      .from("collections")
      .select("*")
      .eq("creator", walletAddress.toLowerCase())
      .order("created_at", { ascending: false });

    if (chainId) query = query.eq("chain_id", chainId);

    const { data } = await query;
    return data || [];
  }

  /**
   * Get collection details via Edge Function.
   */
  async getCollectionDetails(
    collectionAddress: string,
    chainId: number
  ): Promise<unknown | null> {
    return this._callEdgeFunction("api-collections", {
      address: collectionAddress.toLowerCase(),
      chain_id: chainId,
    });
  }

  // ─── Rewards Queries ───

  /**
   * Get flywheel data via the api-flywheel Edge Function.
   */
  async getFlywheelData(
    walletAddress: string,
    chainId: number
  ): Promise<unknown | null> {
    return this._callEdgeFunction("api-flywheel", {
      address: walletAddress.toLowerCase(),
      chain_id: chainId,
    });
  }

  /**
   * Get user points from Supabase.
   */
  async getFlywheelUserPoints(
    walletAddress: string,
    chainId: number
  ): Promise<UserPointsInfo | null> {
    const { data, error } = await this.supabase
      .from("flywheel_user_points")
      .select("*")
      .eq("user_address", walletAddress.toLowerCase())
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
   * Get pool reward info from Supabase.
   */
  async getFlywheelPoolRewards(
    poolAddress: string,
    chainId: number
  ): Promise<PoolRewardInfo | null> {
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

  // ─── Revenue Queries ───

  /**
   * Get creator revenues aggregated per pool.
   * Uses the server-side `get_creator_revenue_summary` RPC which handles aggregation
   * and fee-aware reconciliation (residual < 1% of calculated → treat as fully withdrawn).
   */
  async getCreatorRevenues(
    walletAddress: string,
    chainId?: number
  ): Promise<CreatorRevenueSummary | null> {
    const addr = walletAddress.toLowerCase();

    const { data, error } = await this.supabase.rpc("get_creator_revenue_summary", {
      p_address: addr,
      p_chain_id: chainId ?? null,
    });

    if (error || !data) return null;

    const result = data as {
      pools: CreatorRevenueSummary["pools"];
      totalCalculated: string;
      totalWithdrawn: string;
      totalWithdrawable: string;
    };

    if (!result.pools || result.pools.length === 0) return null;

    return result;
  }

  /**
   * Get collection-specific revenue data.
   * Uses the server-side `get_collection_revenue_summary` RPC which handles aggregation
   * and fee-aware reconciliation (residual < 1% of calculated → treat as fully withdrawn).
   */
  async getCollectionRevenues(
    collectionAddress: string,
    chainId?: number
  ): Promise<CollectionRevenueSummary | null> {
    const addr = collectionAddress.toLowerCase();

    const { data, error } = await this.supabase.rpc("get_collection_revenue_summary", {
      p_collection: addr,
      p_chain_id: chainId ?? null,
    });

    if (error || !data) return null;

    const result = data as {
      collectionAddress: string;
      pools: CollectionRevenueSummary["pools"];
      totalCalculated: string;
      totalWithdrawn: string;
      totalWithdrawable: string;
    };

    if (!result.pools || result.pools.length === 0) return null;

    return result;
  }

  // ─── Protocol Queries ───

  /**
   * Get protocol configuration from Supabase.
   */
  async getProtocolConfig(
    chainId: number,
    poolDeployerAddress?: string
  ): Promise<ProtocolConfig> {
    const result: ProtocolConfig = {
      durationLimits: null,
      slotLimits: null,
      taskAssignmentsPaused: false,
      socialFee: null,
      creationFee: null,
      creationPaused: false,
      protocolFee: null,
    };

    let query = this.supabase
      .from("protocol_config")
      .select("*")
      .eq("chain_id", chainId);

    if (poolDeployerAddress) {
      query = query.eq("contract_address", poolDeployerAddress.toLowerCase());
    }

    const { data, error } = await query.single();
    if (error || !data) return result;

    if (data.min_duration && data.max_duration) {
      result.durationLimits = { min: data.min_duration, max: data.max_duration };
    }
    if (data.max_slot) {
      result.slotLimits = {
        minPrized: data.min_slot_prized ?? "0",
        minNonPrized: data.min_slot_non_prized ?? "0",
        max: data.max_slot,
      };
    }
    result.taskAssignmentsPaused = data.task_assignments_paused === true;
    result.socialFee = data.social_fee ?? null;
    result.creationFee = data.creation_fee ?? null;
    result.creationPaused = data.creation_paused === true;
    result.protocolFee = data.protocol_fee ?? null;

    return result;
  }

  /**
   * Get protocol stats via the api-stats Edge Function.
   */
  async getStats(chainId?: number, period?: string): Promise<ProtocolStats | null> {
    const params: Record<string, string | number | boolean> = {};
    if (chainId) params.chain_id = chainId;
    if (period) params.period = period;
    return this._callEdgeFunction("api-stats", params) as Promise<ProtocolStats | null>;
  }

  // ─── Realtime Subscriptions ───

  /**
   * Subscribe to pool detail changes (pool + participants + winners + activity).
   */
  subscribeToPool(
    poolAddress: string,
    chainId: number,
    callback: () => void
  ): Unsubscribe {
    const addr = poolAddress.toLowerCase();
    const key = `agent-pool:${addr}:${chainId}`;

    const channel = this.supabase
      .channel(key)
      .on("postgres_changes", { event: "*", schema: "public", table: "pools", filter: `address=eq.${addr}` }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "pool_participants", filter: `pool_address=eq.${addr}` }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "pool_winners", filter: `pool_address=eq.${addr}` }, callback)
      .subscribe();

    return () => channel.unsubscribe();
  }

  /**
   * Subscribe to the global pools list changes.
   */
  subscribeToPoolsList(chainId: number, callback: () => void): Unsubscribe {
    const key = `agent-pools-list:${chainId}`;
    const filter = { filter: `chain_id=eq.${chainId}` };

    const channel = this.supabase
      .channel(key)
      .on("postgres_changes", { event: "*", schema: "public", table: "pools", ...filter }, callback)
      .subscribe();

    return () => channel.unsubscribe();
  }

  /**
   * Subscribe to user-specific changes (activity, participation, wins).
   */
  subscribeToUserChanges(walletAddress: string, callback: () => void): Unsubscribe {
    const addr = walletAddress.toLowerCase();
    const key = `agent-user:${addr}`;

    const channel = this.supabase
      .channel(key)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_activity", filter: `user_address=eq.${addr}` }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "pool_participants", filter: `participant_address=eq.${addr}` }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "pool_winners", filter: `winner_address=eq.${addr}` }, callback)
      .subscribe();

    return () => channel.unsubscribe();
  }

  /**
   * Subscribe to rewards changes (points system, user points, pool rewards, claims).
   */
  subscribeToRewards(
    walletAddress: string,
    chainId: number,
    callback: () => void
  ): Unsubscribe {
    const addr = walletAddress.toLowerCase();
    const key = `agent-rewards:${addr}:${chainId}`;

    const channel = this.supabase
      .channel(key)
      .on("postgres_changes", { event: "*", schema: "public", table: "flywheel_points_system", filter: `chain_id=eq.${chainId}` }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "flywheel_user_points", filter: `user_address=eq.${addr}` }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "flywheel_pool_rewards", filter: `chain_id=eq.${chainId}` }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "flywheel_participant_claims", filter: `participant_address=eq.${addr}` }, callback)
      .subscribe();

    return () => channel.unsubscribe();
  }

  // ─── Purchase Auth ───

  /**
   * Generate purchase authorization via the Edge Function.
   */
  async generatePurchaseAuth(
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

  // ─── Private Helpers ───

  /**
   * Call a Supabase Edge Function and return parsed JSON.
   */
  private async _callEdgeFunction(
    slug: string,
    params?: Record<string, string | number | boolean>
  ): Promise<unknown | null> {
    const searchParams = new URLSearchParams();
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value));
        }
      }
    }

    const qs = searchParams.toString();
    const url = `${this.supabaseUrl}/functions/v1/${slug}${qs ? `?${qs}` : ""}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.supabaseKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Map a database pool row (snake_case) to the PoolData interface (camelCase).
   */
  private _mapPoolRow(row: Record<string, unknown>): PoolData {
    return {
      address: (row.address as string) ?? "",
      chainId: (row.chain_id as number) ?? 0,
      name: (row.name as string) ?? "",
      creator: (row.creator as string) ?? "",
      stateNum: (row.state as number) ?? 0,
      state: String(row.state ?? 0),
      startTime: Number(row.start_time ?? 0),
      duration: Number(row.duration ?? 0),
      slotFee: (row.slot_fee as string) ?? "0",
      maxSlots: Number(row.slot_limit ?? 0),
      slotsSold: Number(row.slots_sold ?? 0),
      numberOfWinners: Number(row.winners_count ?? 0),
      winnersSelected: Number(row.winners_selected ?? 0),
      maxSlotsPerAddress: Number(row.max_slots_per_address ?? 0),
      isPrized: (row.is_prized as boolean) ?? false,
      prizeCollection: (row.prize_collection as string) ?? ethers.constants.AddressZero,
      prizeTokenId: Number(row.prize_token_id ?? 0),
      nativePrizeAmount: (row.native_prize_amount as string) ?? "0",
      erc20PrizeToken: (row.erc20_prize_token as string) ?? ethers.constants.AddressZero,
      erc20PrizeAmount: (row.erc20_prize_amount as string) ?? "0",
      socialEngagementRequired: (row.social_engagement_required as boolean) ?? false,
      holderTokenAddress: (row.holder_token_address as string) ?? ethers.constants.AddressZero,
      usesCustomFee: (row.uses_custom_fee as boolean) ?? false,
      isRefundable: (row.is_refundable as boolean) ?? false,
      isPotPrize: (row.is_pot_prize as boolean) ?? false,
      description: (row.description as string) ?? "",
      imageUrl: (row.artwork_url as string) ?? null,
    };
  }
}
