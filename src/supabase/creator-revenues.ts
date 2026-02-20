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

export async function getCreatorRevenues(
  supabase: SupabaseClient,
  walletAddress: string,
  chainId?: number
): Promise<CreatorRevenueSummary | null> {
  if (!walletAddress) return null;
  const addr = walletAddress.toLowerCase();

  try {
    let query = supabase
      .from("creator_revenues")
      .select("pool_address, chain_id, event_type, amount")
      .eq("revenue_recipient", addr);

    if (chainId) query = query.eq("chain_id", chainId);

    const { data: events, error } = await query;
    if (error || !events || events.length === 0) return null;

    const poolMap = new Map<
      string,
      { chainId: number; calculated: bigint; withdrawn: bigint }
    >();

    for (const ev of events as Record<string, unknown>[]) {
      const key = `${ev.pool_address}:${ev.chain_id}`;
      if (!poolMap.has(key)) {
        poolMap.set(key, { chainId: ev.chain_id as number, calculated: BigInt(0), withdrawn: BigInt(0) });
      }
      const entry = poolMap.get(key)!;
      const amt = BigInt(ev.amount as string);
      if (ev.event_type === "calculated") {
        entry.calculated = amt > entry.calculated ? amt : entry.calculated;
      } else if (ev.event_type === "withdrawn") {
        entry.withdrawn += amt;
      }
    }

    const poolAddresses = [...new Set((events as Record<string, unknown>[]).map((e) => e.pool_address as string))];
    const { data: poolRows } = await supabase.from("pools").select("address, chain_id, name, state").in("address", poolAddresses);

    const poolInfoMap = new Map<string, { name: string | null; state: number }>();
    if (poolRows) {
      for (const row of poolRows as Record<string, unknown>[]) {
        poolInfoMap.set(`${row.address}:${row.chain_id}`, { name: row.name as string | null, state: (row.state as number) ?? 0 });
      }
    }

    let totalCalculated = BigInt(0);
    let totalWithdrawn = BigInt(0);
    const pools: CreatorRevenuePool[] = [];

    for (const [key, entry] of poolMap.entries()) {
      const [poolAddr] = key.split(":");
      const info = poolInfoMap.get(key);
      const withdrawable = entry.calculated > entry.withdrawn ? entry.calculated - entry.withdrawn : BigInt(0);
      totalCalculated += entry.calculated;
      totalWithdrawn += entry.withdrawn;
      pools.push({
        poolAddress: poolAddr,
        poolName: info?.name ?? null,
        chainId: entry.chainId,
        calculatedAmount: entry.calculated.toString(),
        withdrawnAmount: entry.withdrawn.toString(),
        withdrawableAmount: withdrawable.toString(),
        state: info?.state ?? 0,
      });
    }

    pools.sort((a, b) => {
      const aW = BigInt(a.withdrawableAmount);
      const bW = BigInt(b.withdrawableAmount);
      if (aW > BigInt(0) && bW === BigInt(0)) return -1;
      if (bW > BigInt(0) && aW === BigInt(0)) return 1;
      return Number(BigInt(b.calculatedAmount) - BigInt(a.calculatedAmount));
    });

    const totalWithdrawable = totalCalculated > totalWithdrawn ? totalCalculated - totalWithdrawn : BigInt(0);

    return {
      pools,
      totalCalculated: totalCalculated.toString(),
      totalWithdrawn: totalWithdrawn.toString(),
      totalWithdrawable: totalWithdrawable.toString(),
    };
  } catch (err) {
    console.error("getCreatorRevenues error:", err);
    return null;
  }
}
