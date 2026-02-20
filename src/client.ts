import { AgentWallet } from "./wallet";
import { PoolService } from "./pool-service";
import { CollectionService } from "./collection-service";
import { RewardsService } from "./rewards-service";
import { DataService } from "./data-service";
import type { AgentClientConfig } from "./types";

/**
 * Main entry point for the dropr Agent SDK.
 * Wires together all services into a single client instance.
 *
 * @example
 * ```typescript
 * const client = new DroprAgentClient({
 *   privateKey: process.env.AGENT_PRIVATE_KEY!,
 *   chainId: 11155420,
 *   supabaseUrl: process.env.SUPABASE_URL!,
 *   supabaseKey: process.env.SUPABASE_ANON_KEY!,
 * });
 * await client.connect();
 *
 * // Discover pools
 * const eligible = await client.data.findEligiblePools(11155420);
 *
 * // Purchase slots
 * const { txHash } = await client.pools.purchaseSlots(eligible[0].address, 1);
 *
 * // Deploy a collection
 * const { collectionAddress } = await client.collections.deployCollection({
 *   standard: 0,
 *   name: "My Collection",
 *   symbol: "MC",
 *   baseURI: "ipfs://...",
 *   dropURI: "ipfs://...",
 *   initialOwner: client.wallet.getAddress(),
 *   royaltyBps: 500,
 *   royaltyRecipient: client.wallet.getAddress(),
 *   maxSupply: 1000,
 *   revealType: 0,
 * });
 * ```
 */
export class DroprAgentClient {
  readonly wallet: AgentWallet;
  readonly pools: PoolService;
  readonly collections: CollectionService;
  readonly rewards: RewardsService;
  readonly data: DataService;

  private _connected = false;

  constructor(config: AgentClientConfig) {
    if (!config.supabaseUrl || !config.supabaseKey) {
      throw new Error("supabaseUrl and supabaseKey are required");
    }

    this.wallet = new AgentWallet({
      privateKey: config.privateKey,
      mnemonic: config.mnemonic,
      hdPath: config.hdPath,
      signer: config.signer,
      provider: config.provider,
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
    });

    this.pools = new PoolService(this.wallet, config.supabaseUrl, config.supabaseKey);
    this.collections = new CollectionService(this.wallet, config.supabaseUrl, config.supabaseKey);
    this.rewards = new RewardsService(this.wallet, config.supabaseUrl, config.supabaseKey);
    this.data = new DataService(config.supabaseUrl, config.supabaseKey);
  }

  /**
   * Initialize the client — resolves the wallet address and creates contract instances.
   * Must be called once before using any service.
   */
  async connect(): Promise<void> {
    if (this._connected) return;
    await this.wallet.connect();
    this._connected = true;
  }

  /**
   * Get the agent's wallet address.
   */
  getAddress(): string {
    return this.wallet.getAddress();
  }

  /**
   * Get the current chain ID.
   */
  getChainId(): number {
    return this.wallet.getChainId();
  }

  /**
   * Check if the client has been connected.
   */
  isConnected(): boolean {
    return this._connected;
  }
}
