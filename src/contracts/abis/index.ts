import ProtocolManagerJSON from "./ProtocolManager.json";
import PoolDeployerJSON from "./PoolDeployer.json";
import RevenueManagerJSON from "./RevenueManager.json";
import NFTFactoryJSON from "./NFTFactory.json";
import DroprERC721AJSON from "./DroprERC721A.json";
import DroprERC1155JSON from "./DroprERC1155.json";
import PoolJSON from "./Pool.json";
import SocialEngagementManagerJSON from "./SocialEngagementManager.json";
import KOLApprovalJSON from "./KOLApproval.json";
import RewardsFlywheelJSON from "./RewardsFlywheel.json";
import PurchaseAuthorizerJSON from "./PurchaseAuthorizer.json";
import PoolRouterJSON from "./PoolRouter.json";

export const ProtocolManagerABI = ProtocolManagerJSON.abi;
export const PoolDeployerABI = PoolDeployerJSON.abi;
export const RevenueManagerABI = RevenueManagerJSON.abi;
export const NFTFactoryABI = NFTFactoryJSON.abi;
export const DroprERC721AABI = DroprERC721AJSON.abi;
export const DroprERC1155ABI = DroprERC1155JSON.abi;
export const PoolABI = PoolJSON.abi;
export const SocialEngagementManagerABI = SocialEngagementManagerJSON.abi;
export const KOLApprovalABI = KOLApprovalJSON.abi;
export const RewardsFlywheelABI = RewardsFlywheelJSON.abi;
export const PurchaseAuthorizerABI = PurchaseAuthorizerJSON.abi;
export const PoolRouterABI = PoolRouterJSON.abi;

export const ERC20ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

export const contractABIs: Record<string, unknown[]> = {
  protocolManager: ProtocolManagerABI,
  poolDeployer: PoolDeployerABI,
  revenueManager: RevenueManagerABI,
  nftFactory: NFTFactoryABI,
  erc721Prize: DroprERC721AABI,
  erc1155Prize: DroprERC1155ABI,
  socialEngagementManager: SocialEngagementManagerABI,
  kolApproval: KOLApprovalABI,
  rewardsFlywheel: RewardsFlywheelABI,
  pool: PoolABI,
  purchaseAuthorizer: PurchaseAuthorizerABI,
  poolRouter: PoolRouterABI,
  erc20: ERC20ABI as unknown[],
};
