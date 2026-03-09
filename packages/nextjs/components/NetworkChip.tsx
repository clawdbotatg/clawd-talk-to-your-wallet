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
  ethereum: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  polygon: "Polygon",
  xdai: "Gnosis",
  gnosis: "Gnosis",
  linea: "Linea",
  scroll: "Scroll",
  "zksync-era": "zkSync",
  zksync: "zkSync",
  mantle: "Mantle",
  monad: "Monad",
  abstract: "Abstract",
  zora: "Zora",
  unichain: "Unichain",
  "binance-smart-chain": "BSC",
};

export default function NetworkChip({ chain }: NetworkChipProps) {
  const key = chain.toLowerCase();
  const iconUrl = CHAIN_ICONS[key];
  const displayName = CHAIN_DISPLAY[key] || chain;

  return (
    <span
      className="inline-flex items-center gap-1 mx-0.5 px-2 py-0.5 align-middle whitespace-nowrap"
      style={{
        backgroundColor: "#FFF4E6",
        border: "1px solid #DDD5C8",
        fontSize: "12px",
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
        <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#DDD5C8" }} />
      )}
      <span style={{ color: "#2C2C2C", fontWeight: 500 }}>{displayName}</span>
    </span>
  );
}
