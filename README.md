# dropr Agent SDK

Headless TypeScript SDK for AI agents to interact with the [dropr.fun](https://dropr.fun) protocol — no browser, no wallet extension required.

## Overview

The dropr Agent SDK enables autonomous agents to:
- Discover and participate in NFT raffle pools
- Deploy and manage NFT collections (ERC721 & ERC1155)
- Claim reward points and pool/creator rewards
- Monitor protocol activity via real-time Supabase subscriptions

All write operations return **unsigned transaction parameters** (Params Mode). Your agent signs and broadcasts the transaction using its own private key — dropr never holds your keys.

## Installation

```bash
# Clone the repository
git clone https://github.com/bitcrypt0/dropr-agent-sdk.git

# Install dependencies
cd dropr-agent-sdk
npm install
```

## Quick Start

### 1. Register your agent

Register at [dropr.fun](https://dropr.fun) → Profile → Agents tab to get your `drpr_agent_...` API key.

### 2. Initialize the client

```typescript
import { DroprAgentClient } from 'dropr-agent-sdk';

const client = new DroprAgentClient({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  chainId: 84532, // Base Sepolia (testnet)
  supabaseUrl: 'https://xanuhcusfbyrcmnuwwys.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhbnVoY3VzZmJ5cmNtbnV3d3lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwMDMxODksImV4cCI6MjA4NTU3OTE4OX0.kSXj6xmnM9fHf9szslxP1kd1x5p6qYWC76JFd_BstBQ',
});

await client.connect();
console.log('Agent wallet:', client.getAddress());
```

### 3. Discover pools

```typescript
const pools = await client.data.getPools({ chainId: 84532, state: 1 }); // Active pools
console.log(`Found ${pools.length} active pools`);
```

### 4. Purchase slots (Params Mode)

All write operations return unsigned tx params. Sign and broadcast them yourself:

```typescript
import { ethers } from 'ethers';

// Step 1: Get purchase signature from dropr backend
const SUPABASE_URL = 'https://xanuhcusfbyrcmnuwwys.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

const authRes = await fetch(`${SUPABASE_URL}/functions/v1/generate-purchase-auth`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    user_address: client.getAddress(),
    pool_address: '0xPoolAddress',
    chain_id: 84532,
  }),
});
const { signature, deadline } = await authRes.json();

// Step 2: Get unsigned tx params from the Agent API
const res = await fetch('https://dropr.fun/api/v1/agent/pools/0xPoolAddress/purchase', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer drpr_agent_...',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    chain_id: 84532,
    slotCount: 1,
    signature,
    deadline,
    tokenIds: [], // ERC721 token IDs for token-gated pools, [] otherwise
  }),
});
const { tx } = await res.json();

// Step 3: Sign and broadcast
const provider = new ethers.providers.JsonRpcProvider('https://base-sepolia-rpc.publicnode.com');
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY!, provider);
const txResponse = await wallet.sendTransaction(tx);
await txResponse.wait();
console.log('Slots purchased:', txResponse.hash);
```

## Supported Chains

| Chain | Chain ID | Status |
|-------|----------|--------|
| OP Sepolia Testnet | 11155420 | ✅ Live |
| Base Sepolia Testnet | 84532 | ✅ Live |
| OP Mainnet | 10 | 🔜 Coming soon |
| Base Mainnet | 8453 | 🔜 Coming soon |

## API Reference

### `DroprAgentClient`

Main entry point. Wires together all services.

```typescript
const client = new DroprAgentClient(config: AgentClientConfig);
await client.connect();

client.wallet      // AgentWallet — key management, contract instances
client.pools       // PoolService — pool creation, purchasing, lifecycle
client.collections // CollectionService — deploy, royalty, vesting, KOL, supply
client.rewards     // RewardsService — points, pool rewards, creator rewards
client.data        // DataService — read-only Supabase queries
```

### `DataService` — Read Operations

```typescript
// Pools
await client.data.getPools(filters)
await client.data.getPool(address, chainId)
await client.data.getUserPoolState(poolAddress, userAddress, chainId)

// Collections
await client.data.getCollection(address, chainId)
await client.data.getCollectionRevenue(address, chainId)

// Rewards
await client.data.getPointsSystemInfo(chainId)
await client.data.getUserPoints(userAddress, chainId)
await client.data.getPoolRewardInfo(poolAddress, chainId)

// Protocol
await client.data.getProtocolConfig(chainId)
```

### `AgentWallet`

```typescript
await client.wallet.connect()
client.wallet.getAddress()
client.wallet.getSigner()
client.wallet.getProvider()
client.wallet.getChainId()
await client.wallet.getBalance()
await client.wallet.switchChain(chainId)
client.wallet.getContract('poolDeployer' | 'nftFactory' | ...)
client.wallet.getPoolContract(poolAddress)
client.wallet.getERC721Contract(collectionAddress)
client.wallet.getERC1155Contract(collectionAddress)
```

## Agent API Base URL

All write operations go through the dropr Agent API:

```
https://dropr.fun/api/v1/agent
```

Authenticate with your API key:
```
Authorization: Bearer drpr_agent_<40 hex chars>
```

## Error Handling

```typescript
import {
  AgentSDKError,
  InsufficientFundsError,
  PoolStateError,
  TransactionRevertedError,
  UnsupportedChainError,
} from 'dropr-agent-sdk';

try {
  // ... agent action
} catch (err) {
  if (err instanceof InsufficientFundsError) {
    console.log(`Need ${err.required}, have ${err.available}`);
  } else if (err instanceof TransactionRevertedError) {
    console.log('Revert reason:', err.revertReason);
  } else if (err instanceof UnsupportedChainError) {
    console.log('Unsupported chain:', err.chainId);
  }
}
```

## Token Approvals

For ERC20 prize pools and reward deposits, token approvals are required before the main transaction:

```typescript
import { ensureERC20Approval } from 'dropr-agent-sdk';
import { ethers } from 'ethers';

await ensureERC20Approval(
  tokenAddress,
  spenderAddress,
  ethers.utils.parseEther('100'),
  client.wallet.getSigner()
);
```

## External NFT Collections & the IMintable Interface

NFT Drop pools on dropr.fun support two sources of NFT prizes:

1. **Protocol-deployed collections** — deployed via `NFTFactory` through the dropr UI or Agent API (`/collections/deploy`). These already implement the required interface.
2. **Externally deployed collections** — custom ERC-721 or ERC-1155 contracts deployed outside of dropr.fun.

For externally deployed collections to be used as prizes in NFT Drop pools, they **must implement the `IMintable` interface**. This interface allows the Pool contract to check available supply, allocate tokens for prizes, mint to winners, and restore allocations if a pool is deleted or goes unengaged.

### IMintable.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IMintable
 * @dev Interface that all external prize contracts must implement to be compatible with PoolDeployer
 * Combines the essential functions needed for prize allocation, minting, and restoration
 */
interface IMintable {
    /**
     * @dev Returns the available supply for the specified token (ERC1155) or entire collection (ERC721)
     * Must account for already allocated supply to other pools
     */
    function availableSupply() external view returns (uint256);
    
    /**
     * @dev ERC1155 variant: Returns available supply for a specific token ID
     */
    function availableSupply(uint256 tokenId) external view returns (uint256);
    
    /**
     * @dev Sets the minter (pool contract) and allocates the specified amount for prizes
     * ERC721 variant: allocates number of tokens
     */
    function setMinterAndAllocation(address minter, uint256 allocation) external;
    
    /**
     * @dev ERC1155 variant: Sets minter and allocates amount for a specific token ID
     */
    function setMinterAndAllocation(address minter, uint256 tokenId, uint256 allocation) external;
    
    /**
     * @dev Mints prizes to winners from pool contracts
     * ERC721 variant: mints specified quantity
     */
    function mint(address to, uint256 quantity) external;
    
    /**
     * @dev ERC1155 variant: mints specified amount of a token ID to winners from pool contracts
     */
    function mint(address to, uint256 id, uint256 amount) external;
    
    /**
     * @dev Called from pool contracts to restore allocated supply to available supply
     * When the pool is deleted or unengaged
     * ERC721 variant: restores allocation for the pool
     */
    function restoreMinterAllocation(address pool) external;
    
    /**
     * @dev ERC1155 variant: restores allocation for a specific pool and token ID
     */
    function restoreMinterAllocation(address pool, uint256 tokenId) external;
}
```

### Standard-Specific Subsets

If your collection only supports one NFT standard, you can implement the relevant subset:

**ERC-721 only:**
```solidity
interface IMintableERC721 {
    function availableSupply() external view returns (uint256);
    function setMinterAndAllocation(address minter, uint256 allocation) external;
    function mint(address to, uint256 quantity) external;
    function restoreMinterAllocation(address pool) external;
}
```

**ERC-1155 only:**
```solidity
interface IMintableERC1155 {
    function availableSupply(uint256 tokenId) external view returns (uint256);
    function setMinterAndAllocation(address minter, uint256 tokenId, uint256 allocation) external;
    function mint(address to, uint256 id, uint256 amount) external;
    function restoreMinterAllocation(address pool, uint256 tokenId) external;
}
```

> **Note:** Collections deployed via the dropr.fun `NFTFactory` (through the UI or the `/collections/deploy` Agent API endpoint) already implement `IMintable` — no additional work is needed. The interface is only required for collections deployed externally.

## License

MIT
