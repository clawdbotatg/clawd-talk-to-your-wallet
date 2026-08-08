import { cache } from "react";
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

/** Server-side resolution for the /<handle> wallet view. ENS lives on mainnet
 * regardless of which chain the app is pointed at, so this is its own client —
 * `_lib/chainConfig` is the Base payment chain and can't answer name queries. */

const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "8GVG8WjDs-sGFRr6Rm839";
const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;

const makeMainnetClient = () => createPublicClient({ chain: mainnet, transport: http(MAINNET_RPC_URL) });
let mainnetClient: ReturnType<typeof makeMainnetClient> | null = null;
function getMainnetClient() {
  if (!mainnetClient) mainnetClient = makeMainnetClient();
  return mainnetClient;
}

// `Address` is widened to `string` project-wide (types/abitype/abi.d.ts).
export type ResolvedWallet = { address: string; ensName: string | null };

/** A name we're willing to spend an RPC call on: at least one dot, and only
 * characters an ENS label can contain. Keeps junk paths (favicon.ico,
 * .well-known/…) from becoming resolver traffic. */
const ENS_LIKE = /^[a-z0-9¡-￿][a-z0-9¡-￿._-]*\.[a-z0-9¡-￿-]{2,}$/i;

/** Resolve a URL segment to a wallet. Accepts a 0x address or an ENS name;
 * returns null for anything that isn't one or doesn't resolve. Cached per
 * request so generateMetadata and the page share a single lookup. */
export const resolveWalletHandle = cache(async (handle: string): Promise<ResolvedWallet | null> => {
  let raw: string;
  try {
    raw = decodeURIComponent(handle).trim();
  } catch {
    return null;
  }
  if (!raw || raw.length > 255) return null;

  if (isAddress(raw)) {
    const address = getAddress(raw);
    return { address, ensName: await reverseLookup(address) };
  }

  if (!ENS_LIKE.test(raw)) return null;

  let name: string;
  try {
    name = normalize(raw);
  } catch {
    return null; // not a valid ENS name after normalization
  }

  try {
    const address = await getMainnetClient().getEnsAddress({ name });
    if (!address) return null;
    return { address: getAddress(address), ensName: name };
  } catch (err) {
    console.error("[ens] resolution failed:", name, err);
    return null;
  }
});

/** Best-effort primary name for an address — a nicer label when someone pastes
 * a raw 0x. Never fatal: an unnamed wallet is the common case. */
async function reverseLookup(address: string): Promise<string | null> {
  try {
    return await getMainnetClient().getEnsName({ address });
  } catch {
    return null;
  }
}
