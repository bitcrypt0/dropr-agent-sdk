import { ethers } from "ethers";
import { ERC20ABI, contractABIs } from "./contracts/abis";
import { extractRevertReason, TransactionRevertedError } from "./errors";

/**
 * Check ERC20 allowance for a given owner→spender pair.
 */
export async function checkERC20Allowance(
  tokenAddress: string,
  owner: string,
  spender: string,
  provider: ethers.providers.Provider
): Promise<ethers.BigNumber> {
  const contract = new ethers.Contract(tokenAddress, ERC20ABI, provider);
  try {
    return await contract.allowance(owner, spender);
  } catch {
    return ethers.BigNumber.from(0);
  }
}

/**
 * Check if an ERC721 token is approved for a spender.
 */
export async function checkERC721Approval(
  tokenAddress: string,
  owner: string,
  spender: string,
  tokenId: string,
  provider: ethers.providers.Provider
): Promise<boolean> {
  const contract = new ethers.Contract(
    tokenAddress,
    contractABIs.erc721Prize as ethers.ContractInterface,
    provider
  );

  try {
    const isApprovedForAll: boolean = await contract.isApprovedForAll(owner, spender);
    if (isApprovedForAll) return true;
  } catch {
    /* not supported, fallback */
  }

  try {
    const approved: string = await contract.getApproved(tokenId);
    return approved?.toLowerCase() === spender.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Approve an ERC20 token for spending. Runs callStatic pre-flight before sending.
 * Returns true if approval was already sufficient, false if a new approval tx was sent.
 */
export async function approveERC20(
  tokenAddress: string,
  spender: string,
  amount: ethers.BigNumber,
  signer: ethers.Signer
): Promise<{ alreadyApproved: boolean; txHash?: string }> {
  const owner = await signer.getAddress();
  const allowance = await checkERC20Allowance(
    tokenAddress,
    owner,
    spender,
    signer.provider!
  );

  if (allowance.gte(amount)) {
    return { alreadyApproved: true };
  }

  const contract = new ethers.Contract(tokenAddress, ERC20ABI, signer);

  try {
    await contract.callStatic.approve(spender, ethers.constants.MaxUint256);
  } catch (err) {
    throw new TransactionRevertedError(
      "ERC20 approval would revert",
      extractRevertReason(err)
    );
  }

  const tx = await contract.approve(spender, ethers.constants.MaxUint256);
  const receipt = await tx.wait();
  return { alreadyApproved: false, txHash: receipt.transactionHash };
}

/**
 * Approve an ERC721 token for spending. Tries setApprovalForAll first, falls back to approve.
 */
export async function approveERC721(
  tokenAddress: string,
  spender: string,
  tokenId: string,
  signer: ethers.Signer
): Promise<{ alreadyApproved: boolean; txHash?: string }> {
  const owner = await signer.getAddress();
  const isApproved = await checkERC721Approval(
    tokenAddress,
    owner,
    spender,
    tokenId,
    signer.provider!
  );

  if (isApproved) {
    return { alreadyApproved: true };
  }

  const contract = new ethers.Contract(
    tokenAddress,
    contractABIs.erc721Prize as ethers.ContractInterface,
    signer
  );

  // Try setApprovalForAll first (more gas-efficient for multiple tokens)
  try {
    await contract.callStatic.setApprovalForAll(spender, true);
    const tx = await contract.setApprovalForAll(spender, true);
    const receipt = await tx.wait();
    return { alreadyApproved: false, txHash: receipt.transactionHash };
  } catch {
    // Fallback to individual token approval
  }

  try {
    await contract.callStatic.approve(spender, tokenId);
    const tx = await contract.approve(spender, tokenId);
    const receipt = await tx.wait();
    return { alreadyApproved: false, txHash: receipt.transactionHash };
  } catch (err) {
    throw new TransactionRevertedError(
      "ERC721 approval would revert",
      extractRevertReason(err)
    );
  }
}

/**
 * Ensure sufficient ERC20 allowance. Approves if needed.
 */
export async function ensureERC20Approval(
  tokenAddress: string,
  spender: string,
  amount: ethers.BigNumber,
  signer: ethers.Signer
): Promise<{ alreadyApproved: boolean; txHash?: string }> {
  return approveERC20(tokenAddress, spender, amount, signer);
}
