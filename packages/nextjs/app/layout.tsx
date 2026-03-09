import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-ui/components/styles.css";
import { Newsreader, Literata, Victor_Mono } from "next/font/google";
import { ScaffoldEthAppWithProviders } from "~~/components/ScaffoldEthAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

const literata = Literata({
  subsets: ["latin"],
  variable: "--font-literata",
});

const victorMono = Victor_Mono({
  subsets: ["latin"],
  variable: "--font-victor-mono",
});

export const metadata = getMetadata({
  title: "DENARAI FINANCIAL GAZETTE",
  description: "Talk to your wallet",
});

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <html
      suppressHydrationWarning
      data-theme="gazette"
      className={`${newsreader.variable} ${literata.variable} ${victorMono.variable}`}
    >
      <body className="font-[family-name:var(--font-literata)]" style={{ backgroundColor: "#FFF8EE", color: "#2C2C2C" }}>
        <ThemeProvider forcedTheme="gazette" enableSystem={false}>
          <ScaffoldEthAppWithProviders>{children}</ScaffoldEthAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldEthApp;
