"use client";

import { Address } from "@scaffold-ui/components";
import { isAddress } from "viem";
import { useEnsAddress } from "wagmi";
import { mainnet } from "wagmi/chains";

interface AddressChipProps {
  address: string; // 0x... address OR ENS name like punk.austingriffith.eth
  ens?: string; // unused — kept for call-site compat
}

// For ENS name strings: resolve to 0x then render <Address>
function EnsNameChip({ name }: { name: string }) {
  const { data: resolvedAddress } = useEnsAddress({
    name,
    chainId: mainnet.id,
  });

  if (resolvedAddress) {
    return (
      <span className="inline-flex align-middle mx-0.5" style={{ color: "#C9A84C" }}>
        <Address address={resolvedAddress} size="sm" onlyEnsOrAddress />
      </span>
    );
  }

  // While resolving or if unresolvable — show name as plain text pill
  return (
    <span className="inline-flex items-center gap-1 mx-0.5 px-2 py-0.5 rounded-full bg-base-300 border border-base-content/10 text-xs align-middle">
      {name}
    </span>
  );
}

export default function AddressChip({ address }: AddressChipProps) {
  if (isAddress(address)) {
    return (
      <span className="inline-flex align-middle mx-0.5" style={{ color: "#C9A84C" }}>
        <Address address={address} size="sm" onlyEnsOrAddress />
      </span>
    );
  }

  // ENS name
  return <EnsNameChip name={address} />;
}
