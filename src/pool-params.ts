import { ethers } from "ethers";
import type { PoolCreateParams, PoolType, SocialTask } from "./types";

const TASK_SEPARATOR = "|";

const ACTION_LABELS: Record<string, Record<string, string>> = {
  twitter: {
    follow: "Follow Account",
    like: "Like Tweet",
    retweet: "Retweet",
    comment: "Comment on Tweet",
    quote: "Quote Tweet",
  },
  discord: {
    join: "Join Server",
    react: "React to Message",
  },
  telegram: {
    join: "Join Channel/Group",
    follow: "Follow Channel",
  },
};

/**
 * Generate a pipe-delimited social task description string from task objects.
 */
export function generateSocialTaskDescription(tasks: SocialTask[]): string {
  if (tasks.length === 0) return "";
  return tasks
    .map((t) => {
      const actionText = ACTION_LABELS[t.platform]?.[t.action] ?? t.action;
      return `${t.platform.toUpperCase()}: ${actionText} - ${t.target}`;
    })
    .join(TASK_SEPARATOR);
}

/**
 * Validate pool creation params. Throws on invalid input.
 */
export function validatePoolParams(params: PoolCreateParams): void {
  if (!params.name || params.name.trim().length === 0) {
    throw new Error("Pool name is required");
  }
  if (params.startTime <= 0) {
    throw new Error("startTime must be a positive unix timestamp");
  }
  if (params.durationMinutes <= 0) {
    throw new Error("durationMinutes must be positive");
  }
  if (params.maxSlots <= 0) {
    throw new Error("maxSlots must be positive");
  }
  if (params.numberOfWinners <= 0) {
    throw new Error("numberOfWinners must be positive");
  }
  if (params.numberOfWinners > params.maxSlots) {
    throw new Error("numberOfWinners cannot exceed maxSlots");
  }
  if (params.socialEngagement && (!params.socialTasks || params.socialTasks.length === 0)) {
    throw new Error(
      "Social engagement is enabled but no tasks provided. Add tasks or disable social engagement."
    );
  }

  // Whitelist, native-giveaway, and erc20-giveaway pools always use the global
  // protocol slot fee. Passing a custom slotFee for these types has no effect
  // on-chain and will result in a transaction revert.
  const GLOBAL_FEE_ONLY_TYPES: PoolType[] = ["whitelist", "native-giveaway", "erc20-giveaway"];
  if (
    GLOBAL_FEE_ONLY_TYPES.includes(params.poolType) &&
    params.slotFee !== undefined &&
    params.slotFee !== "" &&
    params.slotFee !== "0"
  ) {
    throw new Error(
      `Cannot set a custom slotFee for '${params.poolType}' pools. ` +
      `These pool types always use the global protocol slot fee. ` +
      `Remove the slotFee field or set it to "0" to proceed.`
    );
  }
}

// ─── Per-type param builders ───

export function buildWhitelistParams(params: PoolCreateParams, creator: string) {
  return {
    name: params.name,
    startTime: params.startTime,
    duration: params.durationMinutes * 60,
    slotLimit: params.maxSlots,
    winnersCount: params.numberOfWinners,
    maxSlotsPerAddress: 1,
    isPrized: false,
    customSlotFee: 0,
    erc721Drop: false,
    erc1155Drop: true,
    prizeCollection: ethers.constants.AddressZero,
    standard: 0,
    prizeTokenId: 0,
    amountPerWinner: 0,
    creator,
    erc20PrizeToken: ethers.constants.AddressZero,
    erc20PrizeAmount: 0,
    nativePrizeAmount: 0,
  };
}

export function buildNativeGiveawayParams(params: PoolCreateParams, creator: string) {
  return {
    name: params.name,
    startTime: params.startTime,
    duration: params.durationMinutes * 60,
    slotLimit: params.maxSlots,
    winnersCount: params.numberOfWinners,
    maxSlotsPerAddress: params.maxSlotsPerAddress ?? 1,
    isPrized: true,
    customSlotFee: 0,
    erc721Drop: false,
    erc1155Drop: false,
    prizeCollection: ethers.constants.AddressZero,
    standard: 3,
    prizeTokenId: 0,
    amountPerWinner: 0,
    creator,
    erc20PrizeToken: ethers.constants.AddressZero,
    erc20PrizeAmount: ethers.BigNumber.from(0),
    nativePrizeAmount: params.nativePrizeAmount
      ? ethers.utils.parseEther(params.nativePrizeAmount)
      : ethers.BigNumber.from(0),
  };
}

export function buildERC20GiveawayParams(
  params: PoolCreateParams,
  creator: string,
  parsedTokenAmount: ethers.BigNumber
) {
  return {
    name: params.name,
    startTime: params.startTime,
    duration: params.durationMinutes * 60,
    slotLimit: params.maxSlots,
    winnersCount: params.numberOfWinners,
    maxSlotsPerAddress: params.maxSlotsPerAddress ?? 1,
    isPrized: true,
    customSlotFee: ethers.BigNumber.from(0),
    erc721Drop: false,
    erc1155Drop: false,
    prizeCollection: ethers.constants.AddressZero,
    standard: 2,
    prizeTokenId: 0,
    amountPerWinner: 0,
    creator,
    erc20PrizeToken: params.erc20PrizeToken!,
    erc20PrizeAmount: parsedTokenAmount,
    nativePrizeAmount: ethers.BigNumber.from(0),
  };
}

export function buildNFTDropParams(params: PoolCreateParams, creator: string) {
  const customSlotFee =
    params.slotFee && params.slotFee.trim() !== ""
      ? ethers.utils.parseEther(params.slotFee)
      : ethers.BigNumber.from(0);
  return {
    name: params.name,
    startTime: params.startTime,
    duration: params.durationMinutes * 60,
    slotLimit: params.maxSlots,
    winnersCount: params.numberOfWinners,
    maxSlotsPerAddress: params.maxSlotsPerAddress ?? 1,
    isPrized: true,
    customSlotFee,
    erc721Drop: true,
    erc1155Drop: false,
    prizeCollection: params.prizeCollectionAddress!,
    standard: 0,
    prizeTokenId: 0,
    amountPerWinner: 1,
    creator,
    erc20PrizeToken: ethers.constants.AddressZero,
    erc20PrizeAmount: 0,
    nativePrizeAmount: 0,
  };
}

export function buildLuckySaleParams(params: PoolCreateParams, creator: string) {
  const customSlotFee =
    params.slotFee && params.slotFee.trim() !== ""
      ? ethers.utils.parseEther(params.slotFee)
      : ethers.BigNumber.from(0);
  return {
    name: params.name,
    startTime: params.startTime,
    duration: params.durationMinutes * 60,
    slotLimit: params.maxSlots,
    winnersCount: params.numberOfWinners,
    maxSlotsPerAddress: params.maxSlotsPerAddress ?? 1,
    isPrized: true,
    customSlotFee,
    erc721Drop: false,
    erc1155Drop: false,
    prizeCollection: params.prizeCollectionAddress!,
    standard: 0,
    prizeTokenId: params.prizeTokenId ?? 0,
    amountPerWinner: 1,
    creator,
    erc20PrizeToken: ethers.constants.AddressZero,
    erc20PrizeAmount: 0,
    nativePrizeAmount: 0,
  };
}

export function buildPotPrizeParams(params: PoolCreateParams, creator: string) {
  const customSlotFee =
    params.slotFee && params.slotFee.trim() !== ""
      ? ethers.utils.parseEther(params.slotFee)
      : ethers.BigNumber.from(0);
  return {
    name: params.name,
    startTime: params.startTime,
    duration: params.durationMinutes * 60,
    slotLimit: params.maxSlots,
    winnersCount: params.numberOfWinners,
    maxSlotsPerAddress: params.maxSlotsPerAddress ?? 1,
    isPrized: true,
    customSlotFee,
    erc721Drop: false,
    erc1155Drop: false,
    prizeCollection: ethers.constants.AddressZero,
    standard: 3,
    prizeTokenId: 0,
    amountPerWinner: 0,
    creator,
    erc20PrizeToken: ethers.constants.AddressZero,
    erc20PrizeAmount: 0,
    nativePrizeAmount: 0,
  };
}

/**
 * Append shared parameters (social engagement, token-gating, metadata) to base pool params.
 */
export function appendSharedParams(
  base: Record<string, unknown>,
  params: PoolCreateParams
): Record<string, unknown> {
  const tgEnabled = params.tokenGatedEnabled ?? false;
  const holderTokenAddress =
    tgEnabled && params.holderTokenAddress
      ? params.holderTokenAddress
      : ethers.constants.AddressZero;
  const holderTokenStandard = tgEnabled ? (params.holderTokenStandard ?? 0) : 0;
  const minBal =
    tgEnabled && params.minHolderTokenBalance
      ? ethers.BigNumber.from(params.minHolderTokenBalance)
      : ethers.BigNumber.from(0);
  const holderTokenId =
    tgEnabled && params.holderTokenId ? params.holderTokenId : 0;

  const socialEngagementRequired = params.socialEngagement ?? false;
  const socialTaskCount = socialEngagementRequired
    ? (params.socialTasks?.length ?? 0)
    : 0;
  const socialTaskDescription = socialEngagementRequired
    ? generateSocialTaskDescription(params.socialTasks ?? [])
    : "";

  return {
    ...base,
    holderTokenAddress,
    holderTokenStandard,
    minHolderTokenBalance: minBal,
    holderTokenBalance: minBal,
    holderTokenId,
    socialEngagementRequired,
    socialTaskCount,
    socialTaskDescription,
    description: params.description || "",
    twitterLink: params.twitterLink || "",
    discordLink: params.discordLink || "",
    telegramLink: params.telegramLink || "",
    isPotPrize: params.isPotPrize || params.poolType === "pot-prize",
    dropURI: params.dropURI || "",
  };
}

/**
 * Build the complete pool creation parameters object from a PoolCreateParams input.
 * Returns { params, parsedERC20Amount } where parsedERC20Amount is needed for ERC20 approval.
 */
export function buildPoolParams(
  input: PoolCreateParams,
  creator: string,
  parsedERC20Amount?: ethers.BigNumber
): Record<string, unknown> {
  validatePoolParams(input);

  let baseParams: Record<string, unknown>;

  switch (input.poolType) {
    case "whitelist":
      baseParams = buildWhitelistParams(input, creator);
      break;
    case "native-giveaway":
      baseParams = buildNativeGiveawayParams(input, creator);
      break;
    case "erc20-giveaway":
      baseParams = buildERC20GiveawayParams(
        input,
        creator,
        parsedERC20Amount ?? ethers.BigNumber.from(0)
      );
      break;
    case "nft-drop":
      baseParams = buildNFTDropParams(input, creator);
      break;
    case "lucky-sale":
      baseParams = buildLuckySaleParams(input, creator);
      break;
    case "pot-prize":
      baseParams = buildPotPrizeParams(input, creator);
      break;
    default:
      throw new Error(`Unsupported pool type: ${input.poolType}`);
  }

  return appendSharedParams(baseParams, input);
}
