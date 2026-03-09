"use client";

import { Address } from "@scaffold-ui/components";
import { blo } from "blo";
import { isAddress } from "viem";

interface AddressChipProps {
  address: string; // 0x... address OR ENS name like punk.austingriffith.eth
  ens?: string; // ignored — Address component resolves ENS itself
}

// For ENS names (not 0x addresses), show a simple styled pill with blockie from name chars
function EnsPill({ name }: { name: string }) {
  // Generate a color from the ENS name
  const hue = Math.round(name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360);
  const color = `hsl(${hue}, 60%, 52%)`;

  return (
    <span className="inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded-full bg-base-300 border border-base-content/10 text-xs font-mono align-middle whitespace-nowrap">
      <span
        className="w-4 h-4 rounded-full flex-shrink-0"
        style={{
          background: `url(${blo(
            ("0x" +
              name
                .split("")
                .map(c => c.charCodeAt(0).toString(16).padStart(2, "0"))
                .join("")
                .slice(0, 40)
                .padEnd(40, "0")) as `0x${string}`,
          )}) center/cover`,
        }}
      />
      <a
        href={`https://app.ens.domains/${name}`}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline text-base-content/80"
        style={{ color }}
      >
        {name}
      </a>
    </span>
  );
}

export default function AddressChip({ address }: AddressChipProps) {
  if (isAddress(address)) {
    // Use scaffold-ui Address — ENS resolution, avatar, blockie, copy, explorer link
    return (
      <span className="inline-flex align-middle mx-0.5">
        <Address address={address} size="xs" />
      </span>
    );
  }
  // ENS name — show styled pill
  return <EnsPill name={address} />;
}
