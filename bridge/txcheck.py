"""Pre-sign check: does the built transaction match what the user asked for?

Independent of the agent: it sees only facts code derives from the payload —
decoded calldata, simulated balance changes, build-tool parameters — plus the
conversation, never the agent's own description of the card. Two layers:

  1. plain code: an unlimited approval, a recipient the conversation never
     names, a chain the user named that the card doesn't use;
  2. Sage (levanto-sage): "does the transaction contradict the request?"

Eval (evals/sage/eval_tx_match.py, 40 cards, 12 bad): no check 70%, code 88%,
code + Sage 98% with all 12 bad cards caught. The one false alarm was an old
card with no simulation, so a flag warns and asks for an extra confirm — it
never blocks.

Result rides on the payload as `check`: {"ok": True} | {"ok": False,
"reasons": [...]} | {"ok": None, "reasons": [...]} (couldn't double-check).
"""
import json
import os
import re
import urllib.request

SAGE_URL = "https://sage.levanto.ai/decide/batch"
SAGE_TIMEOUT = float(os.environ.get("SAGE_TIMEOUT", "8"))
SAGE_QUESTION = ("Does the transaction contradict the user's request in any way — a different recipient, "
                 "token, amount, chain or direction than the user asked for?")

CHAIN = {1: "Ethereum", 8453: "Base", 10: "Optimism", 42161: "Arbitrum", 137: "Polygon", 100: "Gnosis",
         56: "BNB Chain", 43114: "Avalanche", 59144: "Linea", 534352: "Scroll", 324: "zkSync",
         5000: "Mantle", 81457: "Blast", 42220: "Celo", 130: "Unichain", 4663: "Robinhood Chain"}
CHAIN_WORDS = {"base": "Base", "mainnet": "Ethereum", "ethereum": "Ethereum", "gnosis": "Gnosis",
               "optimism": "Optimism", "arbitrum": "Arbitrum", "polygon": "Polygon", "robinhood": "Robinhood Chain"}
SEL = {"0xa9059cbb": "ERC-20 transfer", "0x095ea7b3": "ERC-20 approve", "0x87517c45": "Permit2 approve",
       "0x3593564c": "Uniswap Universal Router swap", "0x2c57e884": "LI.FI swap", "0x736eac0b": "LI.FI swap",
       "0x3110c7b9": "LI.FI bridge", "0x2e1a7d4d": "WETH unwrap", "0xd0e30db0": "WETH wrap",
       "0x679b6ded": "Arbitrum Orbit bridge deposit (createRetryableTicket)"}
SPENDERS = {"0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LI.FI router",
            "0x000000000022d473030f116ddee9f6b43ac78ba3": "Uniswap Permit2"}
ENS_RE = re.compile(r"\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.eth\b")


def _steps(payload):
    if payload.get("type") == "transaction":
        return [payload.get("transaction") or {}]
    return list(payload.get("steps") or [])


def _resolve_ens(names):
    out = {}
    for name in list(names)[:5]:
        try:
            req = urllib.request.Request(f"https://api.ensideas.com/ens/resolve/{name}",
                                         headers={"User-Agent": "denarai-bridge/1.0"})
            with urllib.request.urlopen(req, timeout=4) as r:
                addr = (json.load(r).get("address") or "").lower()
            if addr:
                out[addr] = name
        except Exception:  # noqa: BLE001 — an unresolved name just stays unnamed
            pass
    return out


def _step_facts(s, ens):
    d = (s.get("data") or "0x").lower()
    sel = d[:10]
    f = {"chain": CHAIN.get(int(s.get("chainId") or 0), s.get("chainId"))}
    try:
        v = int(str(s.get("value") or "0"), 0)
    except ValueError:
        v = 0
    if len(d) <= 2:
        f["call"] = "native send"
        f["recipient"] = (s.get("to") or "").lower()
    else:
        f["call"] = SEL.get(sel, sel)
    if v:
        f["native_value_sent"] = f"{v / 1e18:.10g} ETH"
    if sel == "0xa9059cbb" and len(d) >= 74:
        f["recipient"] = "0x" + d[34:74]
    if sel == "0x095ea7b3" and len(d) >= 138:
        sp = "0x" + d[34:74]
        f["spender"] = SPENDERS.get(sp, sp)
        f["approval"] = "unlimited" if int(d[74:138], 16) > 2 ** 200 else "exact amount for this trade"
    if sel == "0x679b6ded" and len(d) >= 74:
        f["l2_recipient"] = "0x" + d[34:74]
    r = f.get("recipient") or f.get("l2_recipient")
    if r and r in ens:
        f["recipient_ens_name"] = ens[r]
    sim = (s.get("simulation") or {}).get("changes")
    if sim:
        f["simulated_changes_for_user_wallet"] = [
            f"{c.get('direction')} {c.get('amount')} {c.get('symbol')}" for c in sim]
    return f


def _build_params(payload):
    rq = payload.get("requote") or (payload.get("transaction") or {}).get("requote") or {}
    a = rq.get("args") or {}
    keys = ("tokenIn", "fromToken", "tokenOut", "toToken", "fromChainId", "toChainId", "chainId", "to", "amount", "token")
    return {k: a[k] for k in keys if k in a} or None


def _code_reasons(doc):
    """What code alone can see. Plain-English reasons, empty when clean."""
    reasons = []
    convo = (doc["user_request"] + " " + " ".join(doc.get("recent_turns", []))).lower()
    named = {v for k, v in CHAIN_WORDS.items() if re.search(rf"\b{k}\b", doc["user_request"].lower())}
    for s in doc["transaction_steps"]:
        if s.get("approval") == "unlimited":
            reasons.append("It gives unlimited spending access to your tokens.")
        r = (s.get("recipient") or s.get("l2_recipient") or "").lower()
        if r and r not in convo and r != doc["user_wallet"].lower() and not (
                s.get("recipient_ens_name") and s["recipient_ens_name"] in convo):
            reasons.append(f"It sends to {r}, an address you never gave.")
        # A bridge to Robinhood Chain starts on Ethereum, so naming it can't pin the chain.
        if named and s.get("chain") not in named and "Robinhood Chain" not in named:
            reasons.append(f"It runs on {s.get('chain')}, not {' or '.join(sorted(named))}.")
    return list(dict.fromkeys(reasons))


def _sage(doc, key):
    body = {"reasoning": "off", "requests": [{"content": json.dumps(doc, indent=1), "questions": [
        {"id": "contra", "kind": "yesno", "instructions": SAGE_QUESTION}]}]}
    req = urllib.request.Request(SAGE_URL, data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "denarai-bridge/1.0"})
    with urllib.request.urlopen(req, timeout=SAGE_TIMEOUT) as r:
        a = json.load(r)["results"][0]["answers"][0]
    res = (a.get("result") or {}).get("result") or {}
    if not a.get("ok") or res.get("answer") is None:
        raise RuntimeError("no answer")
    return float(res["probability"])


def check(payload, wallet, message, recent=None):
    """Return the `check` dict for a transaction payload (None for chat)."""
    if payload.get("type") not in ("transaction", "multistep_transaction"):
        return None
    recent = recent or []
    turns = [f"[{'user' if m.get('role') == 'user' else 'assistant'}] {str(m.get('content', ''))[:600]}"
             for m in recent[-6:] if isinstance(m, dict)]
    convo = (message + " " + " ".join(turns)).lower()
    ens = _resolve_ens(set(ENS_RE.findall(convo)))
    doc = {"user_request": message[:500], "recent_turns": turns, "user_wallet": wallet,
           "transaction_steps": [_step_facts(s, ens) for s in _steps(payload)]}
    params = _build_params(payload)
    if params:
        doc["build_parameters"] = params

    reasons = _code_reasons(doc)
    key = os.environ.get("SAGE_API_KEY", "")
    p = None
    if key:
        try:
            p = _sage(doc, key)
        except Exception as e:  # noqa: BLE001
            print(f"[txcheck] sage failed: {str(e)[:120]}", flush=True)
    if p is not None and p >= 0.5:
        reasons.append("It may not match what you asked for. Check the recipient, token, amount and chain.")
    out = {"ok": False, "reasons": reasons} if reasons else (
        {"ok": True} if p is not None else {"ok": None, "reasons": ["Couldn't double-check this one."]})
    if p is not None:
        out["sage"] = round(p, 3)
    return out
