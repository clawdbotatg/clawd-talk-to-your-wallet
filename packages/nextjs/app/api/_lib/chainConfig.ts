import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

/** Single source of truth for the payment chain, USDC token, larv.ai ledger URL,
 * treasury/operator addresses and per-request costs. Everything is env-driven so
 * the whole stack can be pointed at Base Sepolia (X402_NETWORK=eip155:84532) or a
 * local larv.ai dev server for testing. */

export const X402_NETWORK = process.env.X402_NETWORK || "eip155:8453";
export const IS_TESTNET = X402_NETWORK === "eip155:84532";

export const CHAIN = IS_TESTNET ? baseSepolia : base;

export const USDC_ADDRESS: `0x${string}` = IS_TESTNET
  ? "0x036CbD53842c5426634e7929541eC2318f3dCF7e" // Base Sepolia USDC (Circle)
  : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base mainnet native USDC

export const BASE_RPC_URL =
  process.env.BASE_RPC_URL ||
  (IS_TESTNET ? "https://sepolia.base.org" : "https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839");

export const LARV_AI_BASE_URL = process.env.LARV_AI_BASE_URL || "https://larv.ai";

export const TREASURY_ADDRESS = (process.env.DENARAI_TREASURY_ADDRESS || "") as `0x${string}`;
export const OPERATOR_ADDRESS = (process.env.OPERATOR_ADDRESS || "") as `0x${string}`;

// Costs — CV first, USDC fallback. USDC amounts are integer micro-USDC (6 decimals).
export const CV_COST_PAGE_LOAD = Number(process.env.CV_COST_PAGE_LOAD || 5_000);
export const CV_COST_CHAT = Number(process.env.CV_COST_CHAT || 25_000);
export const USDC_COST_PAGE_LOAD_MICRO = Number(process.env.USDC_COST_PAGE_LOAD_MICRO || 1_000); // $0.001
export const USDC_COST_CHAT_MICRO = Number(process.env.USDC_COST_CHAT_MICRO || 10_000); // $0.01

export const MIN_TOPUP_CONFIRMATIONS = Number(process.env.MIN_TOPUP_CONFIRMATIONS || 2);

// x402 top-up tiers offered on /pay (price string for x402, micro amount for the ledger)
export const X402_TIERS = [
  { tier: "1", price: "$1.00", amountMicro: 1_000_000 },
  { tier: "5", price: "$5.00", amountMicro: 5_000_000 },
  { tier: "20", price: "$20.00", amountMicro: 20_000_000 },
] as const;

const makePublicClient = () => createPublicClient({ chain: CHAIN, transport: http(BASE_RPC_URL) });
let publicClient: ReturnType<typeof makePublicClient> | null = null;
export function getPublicClient() {
  if (!publicClient) publicClient = makePublicClient();
  return publicClient;
}

const makeOperatorClient = (pk: `0x${string}`) =>
  createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(BASE_RPC_URL) });
let operatorClient: ReturnType<typeof makeOperatorClient> | null = null;
/** Wallet client for the auto-topup operator EOA. Null when OPERATOR_PRIVATE_KEY isn't set. */
export function getOperatorWalletClient() {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) return null;
  if (!operatorClient) operatorClient = makeOperatorClient(pk as `0x${string}`);
  return operatorClient;
}
