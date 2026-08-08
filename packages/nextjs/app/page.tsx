import type { NextPage } from "next";
import WalletWorkspace from "~~/app/_components/WalletWorkspace";

/** The owner view: the connected wallet talks to its own coins, and can sign. */
const Home: NextPage = () => {
  return <WalletWorkspace />;
};

export default Home;
