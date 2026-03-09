import React from "react";
import { useFetchNativeCurrencyPrice } from "@scaffold-ui/hooks";
import { hardhat } from "viem/chains";
import { Faucet } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";

/**
 * Brutalist footer — bold brand, accent bar, raw.
 */
export const Footer = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;
  const { price: nativeCurrencyPrice } = useFetchNativeCurrencyPrice();

  return (
    <div className="min-h-0 px-4 pb-0">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between py-4">
          <span className="font-[family-name:var(--font-space-grotesk)] text-2xl font-bold uppercase tracking-wider">
            DENARAI
          </span>
          <div className="flex items-center gap-4">
            {nativeCurrencyPrice > 0 && (
              <span
                className="font-[family-name:var(--font-ibm-plex-mono)] text-xs uppercase"
                style={{ color: "#666666" }}
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
              className="font-[family-name:var(--font-ibm-plex-mono)] text-xs uppercase"
              style={{ color: "#666666" }}
            >
              SINCE CCXI BC
            </span>
          </div>
        </div>
        <div className="h-1" style={{ backgroundColor: "#FF4500" }} />
      </div>
    </div>
  );
};
