import {
  LARV_AI_BASE_URL,
  TREASURY_ADDRESS,
  USDC_ADDRESS,
  getOperatorWalletClient,
  getPublicClient,
} from "./chainConfig";
import { erc20Abi } from "viem";

/** Unified usage charging: CV first, USDC credits as fallback, with optional
 * operator-pulled auto top-up when the USDC balance runs dry.
 *
 * Degradation contract: if the larv.ai USDC endpoints are unreachable or answer
 * with an unexpected shape, the outcome is exactly what the CV-only flow would
 * have produced today — USDC becomes invisible, never an error source. */

const CV_SPEND_SECRET = process.env.CV_SPEND_SECRET;

export type ChargeResult =
  | { ok: true; source: "cv" | "usdc" | "usdc_autotopup" | "bypass"; cvBalance?: number; usdcBalanceMicro?: number }
  | { ok: false; kind: "insufficient"; cvBalance: number | null; usdcBalanceMicro: number | null }
  | { ok: false; kind: "bad_signature"; status: number; error: string }
  | { ok: false; kind: "soft_error"; status: number; error: string };

type AutoTopup = { enabled: boolean; amountMicro: number; fromWallet: string | null };

export async function chargeCredits(params: {
  cvWallet: string;
  signature: string;
  amountCv: number;
  amountUsdcMicro: number;
}): Promise<ChargeResult> {
  const { cvWallet, signature, amountCv, amountUsdcMicro } = params;

  // Local-dev bypass — never in production
  if (process.env.CV_DEV_BYPASS === "1" && process.env.NODE_ENV !== "production") {
    return { ok: true, source: "bypass" };
  }

  if (!CV_SPEND_SECRET) {
    return { ok: false, kind: "soft_error", status: 503, error: "credit spending not configured" };
  }

  // ─── 1. CV (the existing ledger) ───────────────────────────────────────────
  let cvStatus = 0;
  let cvError = "CV ledger unavailable";
  let cvBalance: number | null = null;
  try {
    const res = await fetch(`${LARV_AI_BASE_URL}/api/cv/spend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: cvWallet, signature, secret: CV_SPEND_SECRET, amount: amountCv }),
    });
    const data = await res.json();
    if (data.success) {
      return { ok: true, source: "cv", cvBalance: data.newBalance };
    }
    cvStatus = res.status;
    cvError = data.error || "CV spend failed";
    if (typeof data.balance === "number") cvBalance = data.balance;

    // Signature problems won't be fixed by trying the other ledger (same sig)
    const isBadSig =
      res.status === 400 ||
      String(data.error || "")
        .toLowerCase()
        .includes("signature");
    if (isBadSig && res.status !== 402 && res.status !== 404) {
      return { ok: false, kind: "bad_signature", status: res.status, error: cvError };
    }

    // 402 = insufficient CV; 404 = wallet never staked (no CV row) — both mean
    // "can't pay with CV, try USDC". Anything else is a CV-ledger fault.
    if (res.status !== 402 && res.status !== 404) {
      return { ok: false, kind: "soft_error", status: res.status, error: cvError };
    }
    if (res.status === 404) cvBalance = 0;
  } catch (err) {
    console.error("[chargeCredits] CV spend unreachable:", err);
    return { ok: false, kind: "soft_error", status: 502, error: "CV ledger unreachable" };
  }

  // ─── 2. USDC credits ───────────────────────────────────────────────────────
  const usdcOutcome = await spendUsdc(cvWallet, signature, amountUsdcMicro);

  if (usdcOutcome.kind === "unavailable") {
    // Reproduce today's CV-only behavior exactly
    if (cvStatus === 402) return { ok: false, kind: "insufficient", cvBalance, usdcBalanceMicro: null };
    return { ok: false, kind: "soft_error", status: cvStatus, error: cvError };
  }

  if (usdcOutcome.kind === "success") {
    return {
      ok: true,
      source: "usdc",
      cvBalance: cvBalance ?? undefined,
      usdcBalanceMicro: usdcOutcome.newBalanceMicro,
    };
  }

  // ─── 3. Auto top-up: pull USDC from the user's approved wallet ────────────
  const auto = usdcOutcome.autoTopup;
  if (auto?.enabled && auto.fromWallet && auto.amountMicro > 0) {
    const pulled = await pullAutoTopup(cvWallet, auto, amountUsdcMicro);
    if (pulled) {
      const retry = await spendUsdc(cvWallet, signature, amountUsdcMicro);
      if (retry.kind === "success") {
        return {
          ok: true,
          source: "usdc_autotopup",
          cvBalance: cvBalance ?? undefined,
          usdcBalanceMicro: retry.newBalanceMicro,
        };
      }
    }
  }

  return { ok: false, kind: "insufficient", cvBalance, usdcBalanceMicro: usdcOutcome.balanceMicro };
}

type UsdcSpendOutcome =
  | { kind: "success"; newBalanceMicro: number }
  | { kind: "insufficient"; balanceMicro: number; autoTopup: AutoTopup | null }
  | { kind: "unavailable" };

async function spendUsdc(cvWallet: string, signature: string, amountMicro: number): Promise<UsdcSpendOutcome> {
  try {
    const res = await fetch(`${LARV_AI_BASE_URL}/api/usdc/spend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: cvWallet, signature, secret: CV_SPEND_SECRET, amountMicro }),
    });
    const data = await res.json();
    if (data.success && typeof data.newBalanceMicro === "number") {
      return { kind: "success", newBalanceMicro: data.newBalanceMicro };
    }
    if (res.status === 402 && typeof data.balanceMicro === "number") {
      return { kind: "insufficient", balanceMicro: data.balanceMicro, autoTopup: data.autoTopup ?? null };
    }
    // 404 route-not-deployed, HTML error pages, unexpected shapes → USDC doesn't exist yet
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Credit the larv.ai USDC ledger for a verified deposit. Idempotent by depositKey. */
export async function creditLedger(params: {
  wallet: string;
  amountMicro: number;
  depositKey: string;
  source: "x402" | "transfer" | "autotopup";
}): Promise<{ success: boolean; duplicate?: boolean; newBalanceMicro?: number; error?: string }> {
  try {
    const res = await fetch(`${LARV_AI_BASE_URL}/api/usdc/credit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: CV_SPEND_SECRET, ...params }),
    });
    const data = await res.json();
    if (!data.success) {
      console.error("[creditLedger] failed:", res.status, data.error, params.depositKey);
    }
    return data;
  } catch (err) {
    console.error("[creditLedger] unreachable:", err, params.depositKey);
    return { success: false, error: "ledger unreachable" };
  }
}

/** Pull a top-up from the user's approved wallet via transferFrom. Returns true if
 * the transfer landed AND the ledger was credited. Failures are logged and
 * swallowed — the caller just falls back to "insufficient". */
async function pullAutoTopup(cvWallet: string, auto: AutoTopup, neededMicro: number): Promise<boolean> {
  const operator = getOperatorWalletClient();
  if (!operator || !TREASURY_ADDRESS || !auto.fromWallet) return false;

  // Pull at least the configured amount, and never less than the pending charge
  const pullMicro = Math.max(auto.amountMicro, neededMicro);
  const from = auto.fromWallet as `0x${string}`;
  const publicClient = getPublicClient();

  try {
    const [allowance, balance] = await Promise.all([
      publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [from, operator.account!.address],
      }),
      publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [from],
      }),
    ]);

    if (allowance < BigInt(pullMicro) || balance < BigInt(pullMicro)) {
      console.log("[autoTopup] skipped — allowance or balance too low", { cvWallet, from, pullMicro });
      return false;
    }

    const txHash = await operator.writeContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "transferFrom",
      args: [from, TREASURY_ADDRESS, BigInt(pullMicro)],
      account: operator.account!,
      chain: operator.chain,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
    if (receipt.status !== "success") {
      console.error("[autoTopup] transferFrom reverted", txHash);
      return false;
    }

    const credit = await creditLedger({
      wallet: cvWallet,
      amountMicro: pullMicro,
      depositKey: `autotopup:${txHash}`,
      source: "autotopup",
    });
    return credit.success;
  } catch (err) {
    console.error("[autoTopup] failed:", err);
    return false;
  }
}
