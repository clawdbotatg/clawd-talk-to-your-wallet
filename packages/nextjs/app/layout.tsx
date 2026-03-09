import { Cinzel, Inter, JetBrains_Mono } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-ui/components/styles.css";
import { ScaffoldEthAppWithProviders } from "~~/components/ScaffoldEthAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

const cinzel = Cinzel({
  subsets: ["latin"],
  variable: "--font-cinzel",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata = getMetadata({
  title: "DENARAI",
  description: "Talk to your wallet",
});

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <html
      suppressHydrationWarning
      data-theme="classical"
      className={`${cinzel.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-[family-name:var(--font-inter)]" style={{ backgroundColor: "#0a0a0a", color: "#E8E4DC" }}>
        <ThemeProvider forcedTheme="classical" enableSystem={false}>
          <ScaffoldEthAppWithProviders>{children}</ScaffoldEthAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldEthApp;
