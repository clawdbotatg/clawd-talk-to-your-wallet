import React from "react";
import { useFetchNativeCurrencyPrice } from "@scaffold-ui/hooks";
import { hardhat } from "viem/chains";
import { Faucet } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";

/**
 * Classical-style footer — thin gold rule, Cinzel brand, "Since CCXI BC"
 */
export const Footer = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;
  const { price: nativeCurrencyPrice } = useFetchNativeCurrencyPrice();

  return (
    <div className="min-h-0 py-4 px-4" style={{ borderTop: "1px solid rgba(201, 168, 76, 0.15)" }}>
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <span className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.3em]" style={{ color: "#8A8578" }}>
          DENARAI
        </span>
        <div className="flex items-center gap-4">
          {nativeCurrencyPrice > 0 && (
            <span className="font-[family-name:var(--font-jetbrains)] text-xs" style={{ color: "#8A8578" }}>
              ETH ${nativeCurrencyPrice.toFixed(2)}
            </span>
          )}
          {isLocalNetwork && (
            <div className="pointer-events-auto">
              <Faucet />
            </div>
          )}
          <span className="text-xs italic" style={{ color: "rgba(138, 133, 120, 0.6)" }}>
            Since CCXI BC
          </span>
        </div>
      </div>
    </div>
  );
};
