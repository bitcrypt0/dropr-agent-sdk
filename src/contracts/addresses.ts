import { SUPPORTED_NETWORKS } from "./networks";

export type ContractName =
  | "protocolManager"
  | "poolDeployer"
  | "revenueManager"
  | "nftFactory"
  | "socialEngagementManager"
  | "rewardsFlywheel"
  | "purchaseAuthorizer";

const ZERO = "0x...";

/**
 * Get a contract address for a specific chain.
 * Returns undefined when the address is a placeholder or the chain is unsupported.
 */
export function getContractAddress(
  chainId: number,
  contract: ContractName
): string | undefined {
  const net = SUPPORTED_NETWORKS[chainId];
  if (!net?.contractAddresses) return undefined;
  const addr = net.contractAddresses[contract];
  if (!addr || addr === ZERO) return undefined;
  return addr;
}

/**
 * Return all non-placeholder contract addresses for a chain.
 */
export function getContractAddresses(
  chainId: number
): Partial<Record<ContractName, string>> {
  const net = SUPPORTED_NETWORKS[chainId];
  if (!net?.contractAddresses) return {};

  const result: Partial<Record<ContractName, string>> = {};
  for (const [key, addr] of Object.entries(net.contractAddresses)) {
    if (addr && addr !== ZERO) {
      result[key as ContractName] = addr;
    }
  }
  return result;
}

/**
 * Check whether essential contracts (protocolManager + poolDeployer) are deployed on a chain.
 */
export function areContractsDeployed(chainId: number): boolean {
  return (
    !!getContractAddress(chainId, "protocolManager") &&
    !!getContractAddress(chainId, "poolDeployer")
  );
}
