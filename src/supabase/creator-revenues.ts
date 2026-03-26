import { SupabaseClient } from "@supabase/supabase-js";

export interface CreatorRevenuePool {
  poolAddress: string;
  poolName: string | null;
  chainId: number;
  calculatedAmount: string;
  withdrawnAmount: string;
  withdrawableAmount: string;
  state: number;
}

export interface CreatorRevenueSummary {
  pools: CreatorRevenuePool[];
  totalCalculated: string;
  totalWithdrawn: string;
  totalWithdrawable: string;
}

/**
 * Fetch creator revenue summary via the server-side `get_creator_revenue_summary` RPC.
 * Handles aggregation and fee-aware reconciliation (residual < 1% → treat as fully withdrawn).
 */
export async function getCreatorRevenues(
  supabase: SupabaseClient,
  walletAddress: string,
  chainId?: number
): Promise<CreatorRevenueSummary | null> {
  if (!walletAddress) return null;

  try {
    const { data, error } = await supabase.rpc("get_creator_revenue_summary", {
      p_address: walletAddress.toLowerCase(),
      p_chain_id: chainId ?? null,
    });

    if (error || !data) {
      if (error) console.error("getCreatorRevenues RPC error:", error.message);
      return null;
    }

    const result = data as {
      pools: CreatorRevenuePool[];
      totalCalculated: string;
      totalWithdrawn: string;
      totalWithdrawable: string;
    };

    if (!result.pools || result.pools.length === 0) return null;

    return result;
  } catch (err) {
    console.error("getCreatorRevenues error:", err);
    return null;
  }
}
