"use client";

interface AssetChipProps {
  symbol: string;
  amount?: string;
  thumbnail?: string;
  chain?: string;
}

const TOKEN_ICONS: Record<string, string> = {
  ETH: "https://cdn.zerion.io/eth.png",
  WETH: "https://cdn.zerion.io/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.png",
  USDC: "https://cdn.zerion.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png",
  USDT: "https://cdn.zerion.io/0xdac17f958d2ee523a2206206994597c13d831ec7.png",
  DAI: "https://cdn.zerion.io/0x6b175474e89094c44da98b954eedeac495271d0f.png",
  GNO: "https://cdn.zerion.io/0x6810e776880c02933d47db1b9fc05908e5386b96.png",
  ARB: "https://cdn.zerion.io/0xb50721bcf8d664c30412cfbc6cf7a15145234ad1.png",
  OP: "https://cdn.zerion.io/0x4200000000000000000000000000000000000042.png",
  MATIC: "https://cdn.zerion.io/0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0.png",
  POL: "https://cdn.zerion.io/7560001f-9b6d-4115-b14a-6c44c4334ef2.png",
  MNT: "https://cdn.zerion.io/f8e50e85-dc0b-4820-a1d8-1f98db6e60f8.png",
  PENDLE: "https://cdn.zerion.io/0x808507121b80c02388fad14726482e061b8da827.png",
  ZORA: "https://cdn.zerion.io/dc541c12-3fb3-4df4-a0a2-b3ccdd349b7d.png",
  DEGEN: "https://cdn.zerion.io/d590ac9c-6971-42db-b900-0bd057033ae0.png",
  RNBW: "https://cdn.zerion.io/33f2717b-8050-4c71-9be6-afafb648b29d.png",
  SCR: "https://cdn.zerion.io/6f0cef93-3e34-444c-aec3-446c09d03df3.png",
  BNB: "https://cdn.zerion.io/0xb8c77482e45f1f44de1745f52c74426c631bdd52.png",
};

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

export default function AssetChip({ symbol, amount, thumbnail, chain }: AssetChipProps) {
  const iconUrl = thumbnail || TOKEN_ICONS[symbol.toUpperCase()] || null;
  const chainIconUrl = chain ? CHAIN_ICONS[chain.toLowerCase()] : null;

  return (
    <span
      className="inline-flex items-center gap-1.5 mx-0.5 px-2 py-0.5 text-xs font-bold align-middle whitespace-nowrap uppercase border-2 font-[family-name:var(--font-ibm-plex-mono)] transition-colors duration-150 hover:border-[#FF4500]"
      style={{
        backgroundColor: "#0d0d0d",
        borderColor: "#FFFFFF",
        color: "#FFFFFF",
      }}
    >
      <span className="relative flex-shrink-0 w-4 h-4">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt={symbol}
            className="w-4 h-4 rounded-full"
            onError={e => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <span
            className="w-4 h-4 flex items-center justify-center text-[8px] font-[family-name:var(--font-space-grotesk)] font-bold uppercase"
            style={{ backgroundColor: "#333333", color: "#FFFFFF" }}
          >
            {symbol.slice(0, 1)}
          </span>
        )}
        {chainIconUrl && (
          <img
            src={chainIconUrl}
            alt={chain}
            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-1 ring-[#1a1a1a]"
            onError={e => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
      </span>
      <span>
        {amount && <span className="mr-0.5">{amount}</span>}
        {symbol.toUpperCase()}
      </span>
    </span>
  );
}
