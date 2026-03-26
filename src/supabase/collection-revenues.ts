import { SupabaseClient } from "@supabase/supabase-js";

export interface CollectionRevenuePool {
  poolAddress: string;
  poolName: string | null;
  chainId: number;
  calculatedAmount: string;
  withdrawnAmount: string;
  withdrawableAmount: string;
  state: number;
  revenueRecipient: string;
}

export interface CollectionRevenueSummary {
  collectionAddress: string;
  pools: CollectionRevenuePool[];
  totalCalculated: string;
  totalWithdrawn: string;
  totalWithdrawable: string;
}

/**
 * Fetch collection revenue summary via the server-side `get_collection_revenue_summary` RPC.
 * Handles aggregation and fee-aware reconciliation (residual < 1% → treat as fully withdrawn).
 */
export async function getCollectionRevenues(
  supabase: SupabaseClient,
  collectionAddress: string,
  chainId?: number
): Promise<CollectionRevenueSummary | null> {
  if (!collectionAddress) return null;

  try {
    const { data, error } = await supabase.rpc("get_collection_revenue_summary", {
      p_collection: collectionAddress.toLowerCase(),
      p_chain_id: chainId ?? null,
    });

    if (error || !data) {
      if (error) console.error("getCollectionRevenues RPC error:", error.message);
      return null;
    }

    const result = data as {
      collectionAddress: string;
      pools: CollectionRevenuePool[];
      totalCalculated: string;
      totalWithdrawn: string;
      totalWithdrawable: string;
    };

    if (!result.pools || result.pools.length === 0) return null;

    return result;
  } catch (err) {
    console.error("getCollectionRevenues error:", err);
    return null;
  }
}
