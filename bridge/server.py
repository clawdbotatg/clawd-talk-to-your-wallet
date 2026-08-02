#!/usr/bin/env python3
"""bridge/server.py — denarai ⇄ claude-p-agent bridge.

The Vercel /api/intent route POSTs here first; we run the turn as a real
Claude Code agent (`claude -p`, Opus, subscription-billed) in bridge/brain/.
If the subscription has no headroom (or we're saturated) we answer 503 and
the route falls back to Bankr — the user never sees an error.

  POST /intent   X-Bridge-Secret: <secret>
                 {message, address, chainId, context, recentMessages?}
              →  {type: chat|transaction|multistep_transaction, ..., engine:"claude-p"}
  GET  /health →  {ok, headroomPct, wouldServe, activeTurns, model}

Env (bridge/.env, else packages/nextjs/.env.local is loaded for tool keys):
  BRIDGE_PORT             default 8790
  BRIDGE_SECRET           shared secret with the Vercel route (required; also
                          persisted to bridge/.bridge-secret on first boot)
  BRIDGE_MODEL            default "opus"
  BRIDGE_SUB_MAX_PCT      refuse when the best plan is above this % (default 90)
  BRIDGE_MAX_CONCURRENT   simultaneous turns (default 4)
  BRIDGE_TURN_TIMEOUT     seconds per turn (default 240)
  CLAUDE_P_AGENT_HOME     default ../claude-p-agent (sibling project)
"""
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
BRAIN = os.path.join(HERE, "brain")
GUARD = os.path.join(BRAIN, "hooks", "bash_guard.py")
# Generated at boot: a PreToolUse hook is the REAL boundary on what shell the
# agent may run (--allowedTools prefix-matches, which chaining defeats).
SETTINGS_PATH = os.path.join(HERE, ".claude-settings.json")


def _load_env_file(path):
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


_load_env_file(os.path.join(HERE, ".env"))
_load_env_file(os.path.join(REPO, "packages", "nextjs", ".env.local"))  # tool API keys

# The brain is the agent dir; keep conversation-key memory next to the bridge.
os.environ["AGENT_DIR"] = BRAIN
os.environ.setdefault("CLAUDE_P_AGENT_MEMORY", os.path.join(HERE, ".memory"))

AGENT_HOME = os.path.abspath(os.environ.get(
    "CLAUDE_P_AGENT_HOME",
    os.path.join(os.path.dirname(REPO), "claude-p-agent")))
sys.path.insert(0, AGENT_HOME)
os.environ["CLAUDE_P_AGENT_HOME"] = AGENT_HOME
from agent import run_turn, current_session, _usage_pct, ACCOUNTS_DIR  # noqa: E402
import agent as _agent_module  # noqa: E402 — for _usage_last (getattr: may be absent)

PORT = int(os.environ.get("BRIDGE_PORT", "8790"))
MODEL = os.environ.get("BRIDGE_MODEL", "opus")
SUB_MAX_PCT = float(os.environ.get("BRIDGE_SUB_MAX_PCT", "90"))
MAX_CONCURRENT = int(os.environ.get("BRIDGE_MAX_CONCURRENT", "4"))
TURN_TIMEOUT = float(os.environ.get("BRIDGE_TURN_TIMEOUT", "240"))

SECRET_FILE = os.path.join(HERE, ".bridge-secret")


def _secret():
    s = os.environ.get("BRIDGE_SECRET", "")
    if s:
        return s
    try:
        with open(SECRET_FILE, encoding="utf-8") as f:
            s = f.read().strip()
    except FileNotFoundError:
        s = ""
    if not s:
        s = secrets.token_hex(24)
        with open(SECRET_FILE, "w", encoding="utf-8") as f:
            f.write(s)
        os.chmod(SECRET_FILE, 0o600)
    return s


SECRET = _secret()


def _write_settings():
    """Hook config for the child: every Bash call is vetted by bash_guard.py."""
    settings = {
        "hooks": {
            "PreToolUse": [
                {
                    "matcher": "Bash",
                    "hooks": [{"type": "command", "command": f"python3 {GUARD}"}],
                }
            ]
        }
    }
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
    return SETTINGS_PATH


_write_settings()

VALID_TYPES = {"chat", "transaction", "multistep_transaction"}

# ── training-data capture ────────────────────────────────────────────────────
# Every turn (all users) appended as one JSONL record: the full prompt context,
# the user message, and exactly what the agent answered. This file IS the
# training set — keep it out of git (bridge/.gitignore).
TURNS_LOG = os.environ.get("BRIDGE_TURNS_LOG", os.path.join(HERE, "turns.jsonl"))
_log_lock = threading.Lock()


def log_turn(record):
    try:
        record["ts"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        line = json.dumps(record, ensure_ascii=False)
        with _log_lock:
            existed = os.path.exists(TURNS_LOG)
            with open(TURNS_LOG, "a", encoding="utf-8") as f:
                f.write(line + "\n")
            if not existed:                       # user chat content — owner-only
                os.chmod(TURNS_LOG, 0o600)
    except Exception as e:  # noqa: BLE001 — logging must never break a turn
        print(f"[turns] log failed: {e}", flush=True)

_turns = threading.Semaphore(MAX_CONCURRENT)
_active = {"n": 0}
_active_lock = threading.Lock()

# ── subscription headroom ────────────────────────────────────────────────────
# The usage endpoint is undocumented and rate-limits hard (429 + Retry-After
# ~20min observed 2026-07-31; a 60s re-poll turns that into a permanent
# blackout). So: refresh in a background thread (a slow probe holding the lock
# once froze /health long enough to false-page "down"), honor Retry-After
# before touching the endpoint again, and keep serving the last good reading
# while rate-limited so the exhaustion gate isn't blind during the back-off.
# The limiter is per-ORG, and this org's other logins are polled by the whole
# harness fleet — don't be the greediest consumer; the gate only needs to see
# a slow climb toward BRIDGE_SUB_MAX_PCT.
HEADROOM_TTL = float(os.environ.get("BRIDGE_HEADROOM_TTL", "300"))
HEADROOM_BACKOFF = float(os.environ.get("BRIDGE_HEADROOM_BACKOFF", "900"))
HEADROOM_STALE_OK = float(os.environ.get("BRIDGE_HEADROOM_STALE_OK", "2700"))
_headroom = {"pct": None, "good_ts": 0.0, "next_probe": 0.0, "refreshing": False}
_headroom_lock = threading.Lock()


def _probe_subprocess():
    """Same probe in a fresh interpreter. Observed 2026-07-30: a long-lived
    process can start returning None while a fresh one reads the value fine
    (the service had booted while the box's login was broken). Cause not yet
    pinned down, so rather than require a restart we re-probe out-of-process
    before declaring usage unknowable."""
    code = (
        "import sys;sys.path.insert(0,%r);"
        "from agent import _usage_pct;"
        "v=_usage_pct('');print('' if v is None else v)" % AGENT_HOME
    )
    try:
        r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=40)
        out = (r.stdout or "").strip()
        return float(out) if out else None
    except Exception:
        return None


def _refresh_headroom():
    """Probe every signed-in plan; runs in a daemon thread, one in flight."""
    best = None
    last = {}
    try:
        candidates = [""]
        try:
            candidates += [os.path.join(ACCOUNTS_DIR, d.name)
                           for d in os.scandir(ACCOUNTS_DIR) if d.is_dir()]
        except OSError:
            pass
        for cfg in candidates:
            pct = _usage_pct(cfg)
            if pct is not None and (best is None or pct < best):
                best = pct
        last = getattr(_agent_module, "_usage_last", None) or {}
        # A fresh interpreter has recovered where a stale in-process one
        # couldn't (2026-07-30) — but against a rate limit it only doubles
        # the hammering, and an expired token reads the same store, so skip
        # it for both.
        if best is None and last.get("status") not in (429, "expired"):
            best = _probe_subprocess()
            if best is not None:
                print("[headroom] in-process probe failed, subprocess probe read "
                      f"{best:.0f}% — investigate stale state", flush=True)
    finally:
        now = time.time()
        with _headroom_lock:
            _headroom["refreshing"] = False
            if best is not None:
                _headroom.update(pct=best, good_ts=now,
                                 next_probe=now + HEADROOM_TTL)
            else:
                wait = max(HEADROOM_BACKOFF, float(last.get("retry_after") or 0))
                _headroom["next_probe"] = now + wait
                if last.get("status") == 429:
                    print(f"[headroom] usage endpoint 429 — backing off {wait:.0f}s,"
                          " serving last good reading meanwhile", flush=True)


def best_headroom_pct():
    """% used of the LEAST-used signed-in plan (the one the router will pick),
    or None if usage is unknowable — in which case we serve and let a hard
    failure fall back to Bankr. Never blocks on the network: returns the
    cached reading (stale up to HEADROOM_STALE_OK during endpoint outages)
    and refreshes in the background."""
    now = time.time()
    with _headroom_lock:
        if now >= _headroom["next_probe"] and not _headroom["refreshing"]:
            _headroom["refreshing"] = True
            threading.Thread(target=_refresh_headroom, daemon=True).start()
        if _headroom["good_ts"] and now - _headroom["good_ts"] <= HEADROOM_STALE_OK:
            return _headroom["pct"]
        return None


def would_serve():
    pct = best_headroom_pct()
    return pct is None or pct <= SUB_MAX_PCT, pct


# ── turn ─────────────────────────────────────────────────────────────────────
def extract_contract_json(text):
    """The brain is told to reply with exactly one JSON object; be forgiving
    about fences/prose anyway (same recovery the Bankr path uses)."""
    if not text:
        return None
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text) or re.search(r"(\{[\s\S]*\})", text)
    if not m:
        return None
    try:
        d = json.loads(m.group(1))
    except ValueError:
        return None
    return d if isinstance(d, dict) else None


# Human labels for the tool calls a user sees while waiting. A swap runs ~2
# minutes of silent tool calls otherwise, which is indistinguishable from a hang.
STEP_LABELS = {
    "getPortfolio": "Reading your portfolio",
    "getOnChainBalance": "Checking your live on-chain balance",
    "searchTransactions": "Searching your transaction history",
    "getTransactionDetails": "Looking up that transaction",
    "getTokenPrice": "Checking the price",
    "getWalletActivity": "Reviewing your recent activity",
    "buildRoute": "Finding the best route",
    "getRouteStatus": "Checking the bridge status",
    "buildTransfer": "Building the transfer",
    "resolveENS": "Resolving the ENS name",
    "getTokenAddress": "Looking up the token address",
    "wrapEth": "Building the wrap",
    "unwrapWeth": "Building the unwrap",
    "validateENSName": "Validating the ENS name",
    "checkENSAvailability": "Checking if that name is available",
    "getENSRentPrice": "Checking the registration price",
    "buildENSRegistration": "Building the registration",
    "simulateAssetChanges": "Simulating the transaction",
    "traceCall": "Tracing the transaction",
    "getTokenLiquidity": "Checking liquidity",
    "buildUniV4Swap": "Building a Uniswap V4 swap",
    "getTokenApprovals": "Auditing token approvals",
    "buildRevoke": "Building the revoke",
    "getContractSource": "Reading the contract source",
    "ethCall": "Reading contract state",
    "getLogs": "Reading on-chain history",
    "getCode": "Inspecting the contract",
    "listSkills": "Checking what I've learned before",
    "readSkill": "Checking what I've learned before",
}
_TOOL_RE = re.compile(r"wallet\.mjs\s+([A-Za-z0-9_]+)")


def step_from_event(event):
    """stream-json event → {tool,label} for a tool call the user should see, or None."""
    if event.get("type") != "assistant":
        return None
    for block in ((event.get("message") or {}).get("content") or []):
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            continue
        cmd = (block.get("input") or {}).get("command") or ""
        m = _TOOL_RE.search(cmd)
        if not m:
            continue
        tool = m.group(1)
        if tool == "logMiss":                 # internal bookkeeping, not progress
            continue
        return {"tool": tool, "label": STEP_LABELS.get(tool, f"Running {tool}")}
    return None


def build_prompt(body):
    """Shared by the blocking and streaming paths."""
    message = (body.get("message") or "").strip()
    address = (body.get("address") or "").strip()
    context = body.get("context") or ""
    recent = body.get("recentMessages") or []
    if not message or not address:
        return None, None, None
    key = f"wallet:{address.lower()}"
    parts = [context.strip()] if context.strip() else []
    if recent and not current_session(key):
        hist = "\n".join(
            f"{'User' if m.get('role') == 'user' else 'Denarai'}: {m.get('content', '')}"
            for m in recent[-10:])
        parts.append(f"Recent conversation:\n{hist}")
    parts.append(f"User message: {message}")
    return "\n\n".join(parts), key, address


def turn_args():
    return [
        "--model", MODEL,
        "--max-turns", "40",
        "--settings", SETTINGS_PATH,
        "--allowedTools", "Bash(node tools/wallet.mjs:*)",
        "--disallowedTools", "Write,Edit,NotebookEdit,WebFetch,WebSearch,Task,TodoWrite,Read,Glob,Grep",
    ]


def finish_turn(text, address, message, context, dt):
    """Parse the agent's reply into the response contract and log the turn."""
    parsed = extract_contract_json(text)
    if parsed and parsed.get("type") in VALID_TYPES:
        parsed["engine"] = "claude-p"
        response = parsed
    elif text:
        response = {"type": "chat", "message": text, "engine": "claude-p"}
    else:
        response = None
    log_turn({
        "wallet": address, "message": message, "context": context,
        "raw_reply": text, "response": response,
        "contract": bool(parsed and parsed.get("type") in VALID_TYPES),
        "duration_s": round(dt, 1), "engine": "claude-p",
    })
    return response


def handle_intent(body):
    message = (body.get("message") or "").strip()
    address = (body.get("address") or "").strip()
    context = body.get("context") or ""
    recent = body.get("recentMessages") or []
    if not message or not address:
        return 400, {"type": "chat", "message": "message and address are required"}

    key = f"wallet:{address.lower()}"

    prompt_parts = [context.strip()] if context.strip() else []
    # A fresh conversation key gets the frontend's rolling history once; after
    # that the resumed session remembers on its own.
    if recent and not current_session(key):
        hist = "\n".join(
            f"{'User' if m.get('role') == 'user' else 'Denarai'}: {m.get('content', '')}"
            for m in recent[-10:])
        prompt_parts.append(f"Recent conversation:\n{hist}")
    prompt_parts.append(f"User message: {message}")
    prompt = "\n\n".join(prompt_parts)

    t0 = time.time()
    text = run_turn(
        prompt,
        remember=key,
        auto_memory=False,          # per-wallet keys must not share facts
        input_via="stdin",          # context blocks can be large
        timeout=TURN_TIMEOUT,
        extra_args=[
            "--model", MODEL,
            "--max-turns", "40",
            "--settings", SETTINGS_PATH,          # PreToolUse guard — the real boundary
            "--allowedTools", "Bash(node tools/wallet.mjs:*)",
            "--disallowedTools", "Write,Edit,NotebookEdit,WebFetch,WebSearch,Task,TodoWrite,Read,Glob,Grep",
        ],
    )
    dt = time.time() - t0

    parsed = extract_contract_json(text)
    if parsed and parsed.get("type") in VALID_TYPES:
        parsed["engine"] = "claude-p"
        print(f"[intent] {address[:10]}… {parsed['type']} in {dt:.1f}s", flush=True)
        response = parsed
    elif text:
        # Model spoke prose instead of the contract — still a usable chat reply.
        print(f"[intent] {address[:10]}… non-contract reply in {dt:.1f}s", flush=True)
        response = {"type": "chat", "message": text, "engine": "claude-p"}
    else:
        response = None

    log_turn({
        "wallet": address,
        "message": message,
        "context": context,
        "raw_reply": text,
        "response": response,
        "contract": bool(parsed and parsed.get("type") in VALID_TYPES),
        "duration_s": round(dt, 1),
        "engine": "claude-p",
    })
    if response:
        return 200, response
    return 502, {"type": "chat", "message": "empty reply from agent"}


# ── http ─────────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):  # quiet default access log
        pass

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            ok, pct = would_serve()
            with _active_lock:
                n = _active["n"]
            return self._json(200, {
                "ok": True, "wouldServe": ok, "headroomPct": pct,
                "activeTurns": n, "model": MODEL, "brain": BRAIN,
            })
        self._json(404, {"error": "not found"})

    def _sse(self, obj):
        self.wfile.write(f"data: {json.dumps(obj)}\n\n".encode())
        self.wfile.flush()

    def _stream_intent(self, body):
        """SSE: emit each tool call as it happens, then the final contract object.

        A swap is ~2 minutes of silent tool calls; without this the UI can't tell
        work from a hang. Same turn as /intent — only the reporting differs."""
        prompt, key, address = build_prompt(body)
        if not prompt:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"type": "chat", "message": "message and address are required"}).encode())
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")     # nginx must not buffer SSE
        self.end_headers()

        seen = []
        broken = {"pipe": False}

        def on_event(event):
            if broken["pipe"]:
                return
            step = step_from_event(event)
            if not step:
                return
            seen.append(step["tool"])
            try:
                self._sse({"type": "step", **step, "n": len(seen)})
            except (BrokenPipeError, ConnectionResetError):
                broken["pipe"] = True   # client navigated away; let the turn finish

        t0 = time.time()
        try:
            text = run_turn(
                prompt, remember=key, auto_memory=False, input_via="stdin",
                on_event=on_event, extra_args=turn_args(),
            )
        except Exception as e:  # noqa: BLE001
            print(f"[stream] turn failed: {e}", flush=True)
            if not broken["pipe"]:
                self._sse({"type": "error", "error": str(e)[:300]})
            return

        dt = time.time() - t0
        response = finish_turn(text, address, (body.get("message") or "").strip(),
                               body.get("context") or "", dt)
        print(f"[stream] {address[:10]}… {len(seen)} steps, "
              f"{response.get('type') if response else 'empty'} in {dt:.1f}s", flush=True)
        if not broken["pipe"]:
            self._sse({"type": "done", "result": response} if response
                      else {"type": "error", "error": "empty reply from agent"})

    def do_POST(self):
        path = self.path.rstrip("/")
        if path not in ("/intent", "/intent/stream"):
            return self._json(404, {"error": "not found"})
        if not secrets.compare_digest(
                self.headers.get("X-Bridge-Secret", ""), SECRET):
            return self._json(401, {"error": "unauthorized"})

        ok, pct = would_serve()
        if not ok:
            return self._json(503, {"error": "no-headroom", "headroomPct": pct})
        if not _turns.acquire(blocking=False):
            return self._json(503, {"error": "busy"})
        with _active_lock:
            _active["n"] += 1
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            if path == "/intent/stream":
                self._stream_intent(body)
            else:
                code, obj = handle_intent(body)
                self._json(code, obj)
        except Exception as e:  # noqa: BLE001 — a failed turn must 500, route falls back
            print(f"[intent] error: {e}", flush=True)
            try:
                self._json(500, {"error": str(e)})
            except Exception:
                pass
        finally:
            with _active_lock:
                _active["n"] -= 1
            _turns.release()


def main():
    ok, pct = would_serve()          # kicks the first background probe
    for _ in range(24):              # give it a moment so the boot log is useful
        if pct is not None:
            break
        time.sleep(0.5)
        ok, pct = would_serve()
    print(f"denarai bridge on http://127.0.0.1:{PORT}", flush=True)
    print(f"  brain={BRAIN}", flush=True)
    print(f"  agent_home={AGENT_HOME}", flush=True)
    print(f"  model={MODEL} max_concurrent={MAX_CONCURRENT} sub_max_pct={SUB_MAX_PCT}", flush=True)
    print(f"  headroom: best plan at {pct if pct is not None else 'unknown'}% used → wouldServe={ok}", flush=True)
    print(f"  secret in {SECRET_FILE}" if not os.environ.get("BRIDGE_SECRET") else "  secret from env", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
