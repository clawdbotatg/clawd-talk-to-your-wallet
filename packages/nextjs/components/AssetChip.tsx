"use client";

interface AssetChipProps {
  symbol: string;
  amount?: string;
  thumbnail?: string;
  chain?: string;
}

// Known token thumbnails from Zerion CDN
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
};

export default function AssetChip({ symbol, amount, thumbnail, chain }: AssetChipProps) {
  const iconUrl = thumbnail || TOKEN_ICONS[symbol.toUpperCase()] || null;

  return (
    <span className="inline-flex items-center gap-1 mx-0.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold align-middle whitespace-nowrap">
      {iconUrl ? (
        <img
          src={iconUrl}
          alt={symbol}
          className="w-3.5 h-3.5 rounded-full flex-shrink-0"
          onError={e => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span className="w-3.5 h-3.5 rounded-full bg-primary/30 flex-shrink-0 flex items-center justify-center text-[8px] font-bold text-primary">
          {symbol.slice(0, 1)}
        </span>
      )}
      <span className="text-primary">
        {amount && <span className="font-mono mr-0.5">{amount}</span>}
        {symbol}
      </span>
      {chain && <span className="text-base-content/30 font-normal">on {chain}</span>}
    </span>
  );
}
