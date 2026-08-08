import { notFound } from "next/navigation";
import WalletWorkspace from "~~/app/_components/WalletWorkspace";
import { resolveWalletHandle } from "~~/services/ens";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

/** Read-only wallet view: denar.ai/safe.atg.eth or denar.ai/0xabc…
 *
 * Static routes (/pay, /debug, /api/*) win over this dynamic segment, so it only
 * catches leftovers — anything that isn't an address or a resolvable ENS name
 * 404s rather than rendering an empty wallet. */

type Props = { params: Promise<{ wallet: string }> };

const shorten = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export async function generateMetadata({ params }: Props) {
  const { wallet } = await params;
  const resolved = await resolveWalletHandle(wallet);
  if (!resolved) {
    return getMetadata({ title: "Wallet not found", description: "That address or ENS name could not be resolved." });
  }
  const label = resolved.ensName || shorten(resolved.address);
  return getMetadata({
    title: label,
    description: `Talk to ${label} — a read-only view of this wallet's holdings, DeFi positions and history.`,
  });
}

export default async function WalletViewPage({ params }: Props) {
  const { wallet } = await params;
  const resolved = await resolveWalletHandle(wallet);
  if (!resolved) notFound();

  return <WalletWorkspace subjectAddress={resolved.address} subjectName={resolved.ensName ?? undefined} readOnly />;
}
