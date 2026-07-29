import { NextRequest, NextResponse } from "next/server";
import { decodeEventLog, erc20Abi } from "viem";
import { requireAuth } from "~~/app/api/_lib/auth";
import { MIN_TOPUP_CONFIRMATIONS, TREASURY_ADDRESS, USDC_ADDRESS, getPublicClient } from "~~/app/api/_lib/chainConfig";
import { creditLedger } from "~~/app/api/_lib/credits";

/** Verify a plain USDC transfer to the treasury and credit the ledger.
 *
 * Who gets credited (anti-theft: a deposit is only ever claimable by its sender):
 * - transfer sender == cvWallet            → credit cvWallet
 * - senderSig from the sender delegating   → credit cvWallet
 * - otherwise                              → credit the sender itself
 *
 * Idempotent per Transfer log (depositKey = txHash:logIndex), so re-submitting
 * a tx never double-credits. */

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const delegationMessage = (cvWallet: string) => `denar.ai USDC credit to ${cvWallet.toLowerCase()}`;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (!TREASURY_ADDRESS) {
    return NextResponse.json({ success: false, error: "top-ups not configured" }, { status: 503 });
  }

  try {
    const { txHash, senderSig } = await req.json();
    if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return NextResponse.json({ success: false, error: "invalid txHash" }, { status: 400 });
    }

    const publicClient = getPublicClient();
    const [receipt, latestBlock] = await Promise.all([
      publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }),
      publicClient.getBlockNumber(),
    ]);

    if (receipt.status !== "success") {
      return NextResponse.json({ success: false, error: "transaction reverted" }, { status: 400 });
    }
    if (latestBlock - receipt.blockNumber < BigInt(MIN_TOPUP_CONFIRMATIONS)) {
      return NextResponse.json(
        { success: false, error: "not enough confirmations yet — retry in a few seconds", retry: true },
        { status: 409 },
      );
    }

    // Find USDC Transfer logs into the treasury
    const treasuryLower = TREASURY_ADDRESS.toLowerCase();
    const cvWalletLower = auth.cvWallet.toLowerCase();
    const credits: { wallet: string; amountMicro: number; newBalanceMicro?: number }[] = [];

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) continue;
      if (log.topics[0] !== TRANSFER_TOPIC) continue;

      let from: string, to: string, value: bigint;
      try {
        const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics });
        from = decoded.args.from.toLowerCase();
        to = decoded.args.to.toLowerCase();
        value = decoded.args.value;
      } catch {
        continue;
      }
      if (to !== treasuryLower || value <= 0n) continue;

      // Decide who this deposit belongs to
      let creditWallet = from;
      if (from === cvWalletLower) {
        creditWallet = cvWalletLower;
      } else if (senderSig) {
        try {
          const delegated = await publicClient.verifyMessage({
            address: from as `0x${string}`,
            message: delegationMessage(cvWalletLower),
            signature: senderSig as `0x${string}`,
          });
          if (delegated) creditWallet = cvWalletLower;
        } catch {
          // keep creditWallet = from
        }
      }

      const amountMicro = Number(value);
      if (!Number.isSafeInteger(amountMicro)) continue;

      const result = await creditLedger({
        wallet: creditWallet,
        amountMicro,
        depositKey: `transfer:${txHash.toLowerCase()}:${log.logIndex}`,
        source: "transfer",
      });
      if (result.success) {
        credits.push({ wallet: creditWallet, amountMicro, newBalanceMicro: result.newBalanceMicro });
      }
    }

    if (credits.length === 0) {
      return NextResponse.json(
        { success: false, error: "no USDC transfer to the treasury found in this transaction" },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, credits });
  } catch (err) {
    console.error("topup verify error:", err);
    return NextResponse.json({ success: false, error: "verification failed" }, { status: 500 });
  }
}
