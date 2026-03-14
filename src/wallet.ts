import { ethers } from "ethers";
import { SUPPORTED_NETWORKS } from "./contracts/networks";
import { getContractAddress } from "./contracts/addresses";
import { contractABIs } from "./contracts/abis";
import { UnsupportedChainError, ContractNotDeployedError } from "./errors";
import type { ContractAddressMap } from "./contracts/types";

export interface AgentWalletConfig {
  privateKey?: string;
  mnemonic?: string;
  hdPath?: string;
  signer?: ethers.Signer;
  provider?: ethers.providers.Provider;
  rpcUrl?: string;
  chainId: number;
}

type ContractName = keyof ContractAddressMap;

const ABI_MAP: Record<ContractName, string> = {
  protocolManager: "protocolManager",
  poolDeployer: "poolDeployer",
  revenueManager: "revenueManager",
  nftFactory: "nftFactory",
  socialEngagementManager: "socialEngagementManager",
  rewardsFlywheel: "rewardsFlywheel",
  purchaseAuthorizer: "purchaseAuthorizer",
  poolRouter: "poolRouter",
};

/**
 * Headless wallet for AI agents — no browser, no window.ethereum.
 * Supports private key, mnemonic, or pre-built signer instantiation.
 */
export class AgentWallet {
  private _signer: ethers.Signer;
  private _provider: ethers.providers.Provider;
  private _chainId: number;
  private _address: string = "";
  private _contracts: Partial<Record<ContractName, ethers.Contract>> = {};

  constructor(config: AgentWalletConfig) {
    const network = SUPPORTED_NETWORKS[config.chainId];
    if (!network) {
      throw new UnsupportedChainError(config.chainId);
    }

    this._chainId = config.chainId;

    if (config.signer && config.provider) {
      this._signer = config.signer;
      this._provider = config.provider;
    } else {
      const rpcUrl = config.rpcUrl || network.rpcUrl;
      this._provider = new ethers.providers.JsonRpcProvider(rpcUrl, {
        chainId: config.chainId,
        name: network.name,
      });

      if (config.privateKey) {
        this._signer = new ethers.Wallet(config.privateKey, this._provider);
      } else if (config.mnemonic) {
        const path = config.hdPath || "m/44'/60'/0'/0/0";
        this._signer = ethers.Wallet.fromMnemonic(config.mnemonic, path).connect(
          this._provider
        );
      } else {
        throw new Error(
          "AgentWallet requires one of: privateKey, mnemonic, or signer+provider"
        );
      }
    }
  }

  /**
   * Initialize the wallet — resolves the address and creates contract instances.
   * Must be called once before using the wallet.
   */
  async connect(): Promise<void> {
    this._address = await this._signer.getAddress();
    this._initContracts();
  }

  private _initContracts(): void {
    this._contracts = {};
    for (const [name, abiKey] of Object.entries(ABI_MAP)) {
      const addr = getContractAddress(this._chainId, name as ContractName);
      const abi = contractABIs[abiKey];
      if (addr && abi) {
        this._contracts[name as ContractName] = new ethers.Contract(
          addr,
          abi as ethers.ContractInterface,
          this._signer
        );
      }
    }
  }

  getAddress(): string {
    if (!this._address) {
      throw new Error("Wallet not connected. Call connect() first.");
    }
    return this._address;
  }

  getSigner(): ethers.Signer {
    return this._signer;
  }

  getProvider(): ethers.providers.Provider {
    return this._provider;
  }

  getChainId(): number {
    return this._chainId;
  }

  /**
   * Get a protocol-level contract instance (poolDeployer, nftFactory, etc.).
   */
  getContract(name: ContractName): ethers.Contract {
    const contract = this._contracts[name];
    if (!contract) {
      throw new ContractNotDeployedError(name, this._chainId);
    }
    return contract;
  }

  /**
   * Create a Pool contract instance for a specific pool address.
   */
  getPoolContract(poolAddress: string): ethers.Contract {
    const abi = contractABIs.pool;
    if (!abi) throw new Error("Pool ABI not available");
    return new ethers.Contract(
      poolAddress,
      abi as ethers.ContractInterface,
      this._signer
    );
  }

  /**
   * Create an ERC721 collection contract instance.
   */
  getERC721Contract(collectionAddress: string): ethers.Contract {
    const abi = contractABIs.erc721Prize;
    if (!abi) throw new Error("ERC721 ABI not available");
    return new ethers.Contract(
      collectionAddress,
      abi as ethers.ContractInterface,
      this._signer
    );
  }

  /**
   * Create an ERC1155 collection contract instance.
   */
  getERC1155Contract(collectionAddress: string): ethers.Contract {
    const abi = contractABIs.erc1155Prize;
    if (!abi) throw new Error("ERC1155 ABI not available");
    return new ethers.Contract(
      collectionAddress,
      abi as ethers.ContractInterface,
      this._signer
    );
  }

  /**
   * Create an ERC20 token contract instance.
   */
  getERC20Contract(tokenAddress: string): ethers.Contract {
    const abi = contractABIs.erc20;
    if (!abi) throw new Error("ERC20 ABI not available");
    return new ethers.Contract(
      tokenAddress,
      abi as ethers.ContractInterface,
      this._signer
    );
  }

  /**
   * Get the wallet's native token balance (ETH, BNB, etc.).
   */
  async getBalance(): Promise<ethers.BigNumber> {
    return this._provider.getBalance(this.getAddress());
  }

  /**
   * Switch to a different chain. Creates a new provider and re-initializes contracts.
   */
  async switchChain(chainId: number, rpcUrl?: string): Promise<void> {
    const network = SUPPORTED_NETWORKS[chainId];
    if (!network) {
      throw new UnsupportedChainError(chainId);
    }

    const url = rpcUrl || network.rpcUrl;
    this._provider = new ethers.providers.JsonRpcProvider(url, {
      chainId,
      name: network.name,
    });

    if (this._signer instanceof ethers.Wallet) {
      this._signer = this._signer.connect(this._provider);
    } else {
      throw new Error(
        "switchChain is only supported for private key / mnemonic wallets"
      );
    }

    this._chainId = chainId;
    this._initContracts();
  }
}
