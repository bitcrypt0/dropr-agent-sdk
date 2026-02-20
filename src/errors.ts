/**
 * Base error class for all Agent SDK errors.
 */
export class AgentSDKError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "AgentSDKError";
  }
}

/**
 * Thrown when the agent's wallet has insufficient ETH or token balance.
 */
export class InsufficientFundsError extends AgentSDKError {
  constructor(
    message: string,
    public readonly required: string,
    public readonly available: string
  ) {
    super(message, "INSUFFICIENT_FUNDS");
    this.name = "InsufficientFundsError";
  }
}

/**
 * Thrown when a pool is not in the correct state for the requested action.
 */
export class PoolStateError extends AgentSDKError {
  constructor(
    message: string,
    public readonly currentState: number,
    public readonly requiredStates: number[]
  ) {
    super(message, "POOL_STATE_ERROR");
    this.name = "PoolStateError";
  }
}

/**
 * Thrown when the agent does not meet eligibility criteria for an action.
 */
export class NotEligibleError extends AgentSDKError {
  constructor(message: string, public readonly reason: string) {
    super(message, "NOT_ELIGIBLE");
    this.name = "NotEligibleError";
  }
}

/**
 * Thrown when a transaction reverts on-chain.
 */
export class TransactionRevertedError extends AgentSDKError {
  constructor(
    message: string,
    public readonly revertReason: string,
    public readonly txHash?: string
  ) {
    super(message, "TRANSACTION_REVERTED");
    this.name = "TransactionRevertedError";
  }
}

/**
 * Thrown when a purchase authorization signature has expired.
 */
export class SignatureExpiredError extends AgentSDKError {
  constructor(message: string, public readonly deadline: number) {
    super(message, "SIGNATURE_EXPIRED");
    this.name = "SignatureExpiredError";
  }
}

/**
 * Thrown when pool creation is paused at the protocol level.
 */
export class CreationPausedError extends AgentSDKError {
  constructor(message = "Pool creation is currently paused by the protocol.") {
    super(message, "CREATION_PAUSED");
    this.name = "CreationPausedError";
  }
}

/**
 * Thrown when the requested chain is not supported.
 */
export class UnsupportedChainError extends AgentSDKError {
  constructor(public readonly chainId: number) {
    super(`Unsupported chain: ${chainId}`, "UNSUPPORTED_CHAIN");
    this.name = "UnsupportedChainError";
  }
}

/**
 * Thrown when a required contract address is not deployed on the target chain.
 */
export class ContractNotDeployedError extends AgentSDKError {
  constructor(
    public readonly contractName: string,
    public readonly chainId: number
  ) {
    super(
      `Contract "${contractName}" is not deployed on chain ${chainId}`,
      "CONTRACT_NOT_DEPLOYED"
    );
    this.name = "ContractNotDeployedError";
  }
}

/**
 * Extract a human-readable revert reason from an ethers error object.
 * Mirrors the logic in usePoolCreation.ts → extractRevertReason().
 */
export function extractRevertReason(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    if (typeof err.reason === "string") return err.reason;
    if (
      err.data &&
      typeof (err.data as Record<string, unknown>).message === "string"
    )
      return (err.data as Record<string, unknown>).message as string;
  }
  const msg =
    (error as Error)?.message ??
    (error as Record<string, unknown>)?.toString?.() ??
    "";
  const match = msg.match(/execution reverted:?\s*([^\n]*)/i);
  if (match?.[1]) return match[1].trim();
  return msg;
}
