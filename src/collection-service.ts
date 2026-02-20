import { ethers } from "ethers";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { AgentWallet } from "./wallet";
import {
  extractRevertReason,
  TransactionRevertedError,
  NotEligibleError,
} from "./errors";
import type {
  CollectionDeployParams,
  CollectionDeployedResult,
  CollectionInfo,
  KOLDetails,
  TxResult,
} from "./types";

// ERC165 interface IDs
const ERC721_INTERFACE_ID = "0x80ac58cd";
const ERC1155_INTERFACE_ID = "0xd9b67a26";

/**
 * Headless collection service for AI agents.
 * Handles NFT collection deployment, reveal, royalties, vesting, supply management,
 * creator minting, KOL management, and ERC1155-specific operations.
 */
export class CollectionService {
  private wallet: AgentWallet;
  private supabase: SupabaseClient;

  constructor(wallet: AgentWallet, supabaseUrl: string, supabaseKey: string) {
    this.wallet = wallet;
    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: { headers: { "X-Client-Info": "dropr-agent-sdk" } },
    });
  }

  // ─── Deployment ───

  /**
   * Deploy a new NFT collection via NFTFactory.
   * Computes URI hashes on-chain via computeURIHash (pure, gas-free),
   * then deploys the collection with all 15 parameters.
   */
  async deployCollection(config: CollectionDeployParams): Promise<CollectionDeployedResult> {
    const nftFactory = this.wallet.getContract("nftFactory");

    // Compute URI hashes via on-chain pure function (gas-free callStatic)
    const dropURIHash: string = await nftFactory.computeURIHash(config.dropURI);
    const unrevealedURIHash: string =
      config.unrevealedURI && config.revealType === 1
        ? await nftFactory.computeURIHash(config.unrevealedURI)
        : ethers.constants.HashZero;

    const deployParams = [
      config.standard,
      config.name,
      config.symbol,
      config.baseURI,
      config.dropURI,
      dropURIHash,
      config.initialOwner || this.wallet.getAddress(),
      config.royaltyBps,
      config.royaltyRecipient || this.wallet.getAddress(),
      config.maxSupply,
      config.revealType,
      config.unrevealedURI || "",
      unrevealedURIHash,
      config.revealTime || 0,
      config.description || "",
    ];

    // callStatic pre-flight
    try {
      await nftFactory.callStatic.deployCollection(...deployParams);
    } catch (err) {
      throw new TransactionRevertedError(
        `Collection deployment would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await nftFactory.deployCollection(...deployParams);
    const receipt = await tx.wait();

    // Parse CollectionDeployed event
    const deployedEvent = receipt.events?.find(
      (e: { event?: string }) => e.event === "CollectionDeployed"
    );
    const collectionAddress =
      deployedEvent?.args?.collection ?? deployedEvent?.args?.[0] ?? null;

    if (!collectionAddress) {
      throw new Error(
        `Collection deployment succeeded (tx: ${receipt.transactionHash}) but could not parse CollectionDeployed event`
      );
    }

    return { collectionAddress, txHash: receipt.transactionHash };
  }

  // ─── Reveal ───

  /**
   * Reveal a delayed-reveal collection. Only callable by the collection owner.
   */
  async revealCollection(collectionAddress: string): Promise<TxResult> {
    const contract = await this._getCollectionContract(collectionAddress);

    try {
      await contract.callStatic.reveal();
    } catch (err) {
      throw new TransactionRevertedError(
        `Reveal would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.reveal();
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── Royalties ───

  /**
   * Set royalty configuration for a collection.
   */
  async setRoyalty(
    collectionAddress: string,
    basisPoints: number,
    recipient: string
  ): Promise<TxResult> {
    const contract = await this._getCollectionContract(collectionAddress);

    try {
      await contract.callStatic.setRoyalty(basisPoints, recipient);
    } catch (err) {
      throw new TransactionRevertedError(
        `Set royalty would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.setRoyalty(basisPoints, recipient);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── Vesting ───

  /**
   * Declare the creator allocation percentage for a collection.
   */
  async declareCreatorAllocation(
    collectionAddress: string,
    percentage: number,
    tokenId?: number
  ): Promise<TxResult> {
    const contract = await this._getCollectionContract(collectionAddress);
    const isERC721 = await this.isERC721(collectionAddress);

    const args = isERC721 ? [percentage] : [tokenId ?? 0, percentage];

    try {
      await contract.callStatic.declareCreatorAllocation(...args);
    } catch (err) {
      throw new TransactionRevertedError(
        `Declare allocation would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.declareCreatorAllocation(...args);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Configure creator vesting schedule for a collection.
   */
  async configureCreatorVesting(
    collectionAddress: string,
    cliffEnd: number,
    numUnlocks: number,
    durationSecs: number,
    tokenId?: number
  ): Promise<TxResult> {
    const contract = await this._getCollectionContract(collectionAddress);
    const isERC721 = await this.isERC721(collectionAddress);

    const args = isERC721
      ? [cliffEnd, numUnlocks, durationSecs]
      : [tokenId ?? 0, cliffEnd, numUnlocks, durationSecs];

    try {
      await contract.callStatic.configureCreatorVesting(...args);
    } catch (err) {
      throw new TransactionRevertedError(
        `Configure vesting would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.configureCreatorVesting(...args);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── Supply Management ───

  /**
   * Cut the maximum supply of a collection.
   */
  async cutSupply(
    collectionAddress: string,
    percentage: number,
    tokenId?: number
  ): Promise<TxResult> {
    const contract = await this._getCollectionContract(collectionAddress);
    const isERC721 = await this.isERC721(collectionAddress);
    const args = isERC721 ? [percentage] : [tokenId ?? 0, percentage];

    try {
      await contract.callStatic.cutSupply(...args);
    } catch (err) {
      throw new TransactionRevertedError(
        `Cut supply would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.cutSupply(...args);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Reduce the creator allocation for a collection.
   */
  async reduceCreatorAllocation(
    collectionAddress: string,
    percentage: number,
    tokenId?: number
  ): Promise<TxResult> {
    const contract = await this._getCollectionContract(collectionAddress);
    const isERC721 = await this.isERC721(collectionAddress);
    const args = isERC721 ? [percentage] : [tokenId ?? 0, percentage];

    try {
      await contract.callStatic.reduceCreatorAllocation(...args);
    } catch (err) {
      throw new TransactionRevertedError(
        `Reduce allocation would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.reduceCreatorAllocation(...args);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Restore minter allocation for a pool.
   */
  async restoreMinterAllocation(
    collectionAddress: string,
    poolAddress: string,
    tokenId?: number
  ): Promise<TxResult> {
    const contract = await this._getCollectionContract(collectionAddress);
    const isERC721 = await this.isERC721(collectionAddress);
    const args = isERC721 ? [poolAddress] : [poolAddress, tokenId ?? 0];

    try {
      await contract.callStatic.restoreMinterAllocation(...args);
    } catch (err) {
      throw new TransactionRevertedError(
        `Restore allocation would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.restoreMinterAllocation(...args);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── Creator Mint ───

  /**
   * Creator mint tokens from a collection.
   */
  async creatorMint(
    collectionAddress: string,
    recipient: string,
    quantity: number,
    tokenId?: number
  ): Promise<TxResult> {
    const contract = await this._getCollectionContract(collectionAddress);
    const isERC721 = await this.isERC721(collectionAddress);
    const args = isERC721
      ? [recipient, quantity]
      : [recipient, tokenId ?? 0, quantity];

    try {
      await contract.callStatic.creatorMint(...args);
    } catch (err) {
      throw new TransactionRevertedError(
        `Creator mint would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.creatorMint(...args);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── KOL Management ───

  /**
   * Approve a KOL (Key Opinion Leader) for a collection.
   */
  async approveKOL(
    collectionAddress: string,
    kolAddress: string,
    poolLimit: number,
    feeWei: string,
    winnerLimit: number
  ): Promise<TxResult> {
    const contract = await this._getCollectionContract(collectionAddress);

    try {
      await contract.callStatic.approveKOL(
        kolAddress,
        poolLimit,
        ethers.BigNumber.from(feeWei),
        winnerLimit
      );
    } catch (err) {
      throw new TransactionRevertedError(
        `Approve KOL would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.approveKOL(
      kolAddress,
      poolLimit,
      ethers.BigNumber.from(feeWei),
      winnerLimit
    );
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Revoke a KOL's approval.
   */
  async revokeKOL(collectionAddress: string, kolAddress: string): Promise<TxResult> {
    const contract = await this._getCollectionContract(collectionAddress);

    try {
      await contract.callStatic.revokeKOL(kolAddress);
    } catch (err) {
      throw new TransactionRevertedError(
        `Revoke KOL would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.revokeKOL(kolAddress);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Get KOL details for a given address on a collection.
   */
  async getKOLDetails(
    collectionAddress: string,
    kolAddress: string
  ): Promise<KOLDetails> {
    const contract = await this._getCollectionContract(collectionAddress);

    try {
      const details = await contract.kolDetails(kolAddress);
      return {
        isApproved: details.isApproved ?? false,
        poolLimit: Number(details.poolLimit ?? 0),
        feeWei: (details.fee ?? ethers.BigNumber.from(0)).toString(),
        winnerLimit: Number(details.winnerLimit ?? 0),
      };
    } catch {
      return { isApproved: false, poolLimit: 0, feeWei: "0", winnerLimit: 0 };
    }
  }

  // ─── ERC1155-Only Methods ───

  /**
   * Create a new token ID on an ERC1155 collection.
   */
  async createNewToken(
    collectionAddress: string,
    tokenId: number,
    maxSupply: number
  ): Promise<TxResult> {
    const isERC721 = await this.isERC721(collectionAddress);
    if (isERC721) {
      throw new NotEligibleError(
        "createNewToken is only available for ERC1155 collections",
        "wrong_standard"
      );
    }

    const contract = this.wallet.getERC1155Contract(collectionAddress);

    try {
      await contract.callStatic.createNewToken(tokenId, maxSupply);
    } catch (err) {
      throw new TransactionRevertedError(
        `Create token would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.createNewToken(tokenId, maxSupply);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  /**
   * Set the URI for a specific token ID on an ERC1155 collection.
   */
  async setTokenURI(
    collectionAddress: string,
    tokenId: number,
    uri: string
  ): Promise<TxResult> {
    const isERC721 = await this.isERC721(collectionAddress);
    if (isERC721) {
      throw new NotEligibleError(
        "setTokenURI is only available for ERC1155 collections",
        "wrong_standard"
      );
    }

    const contract = this.wallet.getERC1155Contract(collectionAddress);

    try {
      await contract.callStatic.setURI(tokenId, uri);
    } catch (err) {
      throw new TransactionRevertedError(
        `Set URI would revert: ${extractRevertReason(err)}`,
        extractRevertReason(err)
      );
    }

    const tx = await contract.setURI(tokenId, uri);
    const receipt = await tx.wait();
    return { txHash: receipt.transactionHash };
  }

  // ─── Reading ───

  /**
   * Detect whether a collection is ERC721 or ERC1155 via ERC165 supportsInterface.
   */
  async isERC721(collectionAddress: string): Promise<boolean> {
    const provider = this.wallet.getProvider();
    const contract = new ethers.Contract(
      collectionAddress,
      ["function supportsInterface(bytes4 interfaceId) view returns (bool)"],
      provider
    );

    try {
      return await contract.supportsInterface(ERC721_INTERFACE_ID);
    } catch {
      // Default to ERC721 if supportsInterface fails
      return true;
    }
  }

  /**
   * Get collection info from Supabase, with on-chain fallback for standard detection.
   */
  async getCollectionInfo(collectionAddress: string): Promise<CollectionInfo | null> {
    const chainId = this.wallet.getChainId();
    const { data, error } = await this.supabase
      .from("collections")
      .select("*")
      .eq("address", collectionAddress.toLowerCase())
      .eq("chain_id", chainId)
      .single();

    if (error || !data) return null;

    return {
      address: data.address,
      chainId: data.chain_id,
      creator: data.creator,
      standard: data.standard,
      name: data.name,
      symbol: data.symbol,
      description: data.description ?? "",
      baseUri: data.base_uri ?? "",
      dropUri: data.drop_uri ?? "",
      unrevealedUri: data.unrevealed_uri ?? "",
      dropUriHash: data.drop_uri_hash ?? "",
      unrevealedUriHash: data.unrevealed_uri_hash ?? "",
      isRevealed: data.is_revealed ?? false,
      maxSupply: data.max_supply ?? 0,
      creatorAllocation: data.creator_allocation ?? 0,
      currentSupply: data.current_supply ?? 0,
      isExternal: data.is_external ?? false,
      vestingCliffEnd: data.vesting_cliff_end ? Number(data.vesting_cliff_end) : null,
      vestingNumUnlocks: data.vesting_num_unlocks ?? null,
      vestingDurationBetweenUnlocks: data.vesting_duration_between_unlocks
        ? Number(data.vesting_duration_between_unlocks)
        : null,
    };
  }

  // ─── Private Helpers ───

  /**
   * Get the appropriate collection contract (ERC721 or ERC1155) based on standard detection.
   */
  private async _getCollectionContract(collectionAddress: string): Promise<ethers.Contract> {
    const is721 = await this.isERC721(collectionAddress);
    return is721
      ? this.wallet.getERC721Contract(collectionAddress)
      : this.wallet.getERC1155Contract(collectionAddress);
  }
}
