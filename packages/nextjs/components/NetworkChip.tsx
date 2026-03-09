"use client";

interface NetworkChipProps {
  chain: string;
}

const CHAIN_ICONS: Record<string, string> = {
  ethereum: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
  base: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
  arbitrum: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg",
  optimism: "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg",
  polygon: "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg",
  xdai: "https://icons.llamao.fi/icons/chains/rsz_xdai.jpg",
  gnosis: "https://icons.llamao.fi/icons/chains/rsz_xdai.jpg",
  linea: "https://icons.llamao.fi/icons/chains/rsz_linea.jpg",
  scroll: "https://icons.llamao.fi/icons/chains/rsz_scroll.jpg",
  "zksync-era": "https://icons.llamao.fi/icons/chains/rsz_zksync%20era.jpg",
  zksync: "https://icons.llamao.fi/icons/chains/rsz_zksync%20era.jpg",
  mantle: "https://icons.llamao.fi/icons/chains/rsz_mantle.jpg",
  monad: "https://icons.llamao.fi/icons/chains/rsz_monad.jpg",
  abstract: "https://icons.llamao.fi/icons/chains/rsz_abstract.jpg",
  zora: "https://icons.llamao.fi/icons/chains/rsz_zora.jpg",
  unichain: "https://icons.llamao.fi/icons/chains/rsz_unichain.jpg",
  "binance-smart-chain": "https://icons.llamao.fi/icons/chains/rsz_binance.jpg",
};

const CHAIN_DISPLAY: Record<string, string> = {
  ethereum: "ETHEREUM",
  base: "BASE",
  arbitrum: "ARBITRUM",
  optimism: "OPTIMISM",
  polygon: "POLYGON",
  xdai: "GNOSIS",
  gnosis: "GNOSIS",
  linea: "LINEA",
  scroll: "SCROLL",
  "zksync-era": "ZKSYNC",
  zksync: "ZKSYNC",
  mantle: "MANTLE",
  monad: "MONAD",
  abstract: "ABSTRACT",
  zora: "ZORA",
  unichain: "UNICHAIN",
  "binance-smart-chain": "BSC",
};

export default function NetworkChip({ chain }: NetworkChipProps) {
  const key = chain.toLowerCase();
  const iconUrl = CHAIN_ICONS[key];
  const displayName = CHAIN_DISPLAY[key] || chain.toUpperCase();

  return (
    <span
      className="inline-flex items-center gap-1 mx-0.5 px-2 py-0.5 text-xs font-bold align-middle whitespace-nowrap uppercase border-2 font-[family-name:var(--font-ibm-plex-mono)]"
      style={{
        backgroundColor: "#0d0d0d",
        borderColor: "#FFFFFF",
        color: "#FFFFFF",
      }}
    >
      {iconUrl ? (
        <img
          src={iconUrl}
          alt={displayName}
          className="w-3.5 h-3.5 rounded-full flex-shrink-0"
          onError={e => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#666666" }} />
      )}
      <span>{displayName}</span>
    </span>
  );
}
