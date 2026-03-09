import React from "react";
import { useFetchNativeCurrencyPrice } from "@scaffold-ui/hooks";
import { hardhat } from "viem/chains";
import { Faucet } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";

/**
 * Gazette-style footer — thin rule, brand italic, "Since CCXI BC"
 */
export const Footer = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;
  const { price: nativeCurrencyPrice } = useFetchNativeCurrencyPrice();

  return (
    <div className="min-h-0 py-4 px-4" style={{ borderTop: "3px solid #2C2C2C" }}>
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <span
          className="font-[family-name:var(--font-newsreader)] italic"
          style={{ fontSize: "1.25rem", letterSpacing: "0.08em", color: "#2C2C2C" }}
        >
          Denarai
        </span>
        <div className="flex items-center gap-4">
          {nativeCurrencyPrice > 0 && (
            <span
              className="font-[family-name:var(--font-victor-mono)]"
              style={{ fontSize: "12px", color: "#8B8680" }}
            >
              ETH ${nativeCurrencyPrice.toFixed(2)}
            </span>
          )}
          {isLocalNetwork && (
            <div className="pointer-events-auto">
              <Faucet />
            </div>
          )}
          <span
            className="font-[family-name:var(--font-victor-mono)]"
            style={{ fontSize: "10px", color: "#8B8680" }}
          >
            Since CCXI BC
          </span>
        </div>
      </div>
    </div>
  );
};
