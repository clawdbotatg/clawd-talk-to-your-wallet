import { defineChain } from "viem";
import * as chains from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";

/** Chains a transaction card can sign on, beyond the app's target networks.
 *
 * The agent builds calldata for any chain LI.FI or its own tools reach, but
 * wagmi can only switch to chains in its config — anything else failed with
 * "Could not switch to chain 100" (a Gnosis bridge, 2026-09-26: four rebuilds,
 * the user gave up and used jumper.exchange). These chains are added to wagmi
 * only, so the network picker and portfolio keep the target-network set; a
 * wallet that lacks one gets an "add network" prompt built from this config. */
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

export const EXTRA_SIGNING_CHAINS = [
  chains.gnosis,
  chains.bsc,
  chains.avalanche,
  chains.linea,
  chains.scroll,
  chains.zksync,
  chains.mantle,
  chains.blast,
  chains.celo,
  chains.unichain,
  robinhood,
] as const;

const ALL_SIGNING_CHAINS = [...scaffoldConfig.targetNetworks, chains.mainnet, ...EXTRA_SIGNING_CHAINS];

export const SIGNABLE_CHAIN_IDS = new Set<number>(ALL_SIGNING_CHAINS.map(c => c.id));

export const SIGNABLE_CHAIN_NAMES = [...new Map(ALL_SIGNING_CHAINS.map(c => [c.id, c.name])).values()];

const chainName = (id: number) =>
  ALL_SIGNING_CHAINS.find(c => c.id === id)?.name ??
  Object.values(chains).find(c => (c as chains.Chain)?.id === id)?.name ??
  `chain ${id}`;

/** Chain ids in a transaction payload that this app can't sign on. */
export function unsignableChains(payload: {
  type?: unknown;
  transaction?: { chainId?: unknown };
  steps?: unknown;
}): number[] {
  const ids: unknown[] = [];
  if (payload?.type === "transaction") ids.push(payload.transaction?.chainId);
  if (payload?.type === "multistep_transaction" && Array.isArray(payload.steps)) {
    for (const s of payload.steps) ids.push((s as { chainId?: unknown })?.chainId);
  }
  return [...new Set(ids.map(Number).filter(id => Number.isFinite(id) && id > 0 && !SIGNABLE_CHAIN_IDS.has(id)))];
}

export function unsignableRefusal(ids: number[]): string {
  return `I built that on ${ids.map(chainName).join(" and ")}, but denar.ai can't sign transactions on that chain yet, so I won't hand you a card that can't be sent. Chains I can sign on: ${SIGNABLE_CHAIN_NAMES.join(", ")}.`;
}

/** wallet_addEthereumChain params from the real chain definition — the cards'
 * old fallback sent ETH as the currency and a mainnet RPC for every chain,
 * which wallets reject (it never could add Gnosis). */
export function addChainParams(id: number) {
  const c = ALL_SIGNING_CHAINS.find(ch => ch.id === id);
  if (!c) return null;
  return {
    chainId: `0x${id.toString(16)}`,
    chainName: c.name,
    nativeCurrency: c.nativeCurrency,
    rpcUrls: [...c.rpcUrls.default.http],
    blockExplorerUrls: c.blockExplorers?.default ? [c.blockExplorers.default.url] : [],
  };
}
