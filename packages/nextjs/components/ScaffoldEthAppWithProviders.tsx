"use client";

import { useEffect, useState } from "react";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProgressBar as ProgressBar } from "next-nprogress-bar";
import { Toaster } from "react-hot-toast";
import { WagmiProvider } from "wagmi";
import { Footer } from "~~/components/Footer";
import { Header } from "~~/components/Header";
import { BlockieAvatar } from "~~/components/scaffold-eth";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

const classicalRainbowTheme = darkTheme({
  accentColor: "#C9A84C",
  accentColorForeground: "#0a0a0a",
  borderRadius: "none",
  fontStack: "system",
});

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <div className="flex flex-col min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
        <Header />
        <main className="relative flex flex-col flex-1">{children}</main>
        <Footer />
      </div>
      <Toaster />
    </>
  );
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export const ScaffoldEthAppWithProviders = ({ children }: { children: React.ReactNode }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider avatar={BlockieAvatar} theme={mounted ? classicalRainbowTheme : classicalRainbowTheme}>
          <ProgressBar height="2px" color="#C9A84C" />
          <ScaffoldEthApp>{children}</ScaffoldEthApp>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
