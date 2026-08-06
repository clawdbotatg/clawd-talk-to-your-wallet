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
from agent import run_turn, current_session  # noqa: E402

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

# ── in-flight turn registry (survives a browser reload) ──────────────────────
# The turn keeps running when a client disconnects, so the answer exists —
# it just had nowhere to go. Keep the live steps and the finished result per
# wallet so a reloaded page can reattach and collect both.
INFLIGHT_KEEP = float(os.environ.get("BRIDGE_INFLIGHT_KEEP", "900"))   # keep results 15 min
_inflight = {}
_inflight_lock = threading.Lock()


def _turn_start(wallet, message):
    turn_id = f"{int(time.time() * 1000)}"
    with _inflight_lock:
        for w, t in list(_inflight.items()):        # prune finished + expired
            if t.get("done_ts") and time.time() - t["done_ts"] > INFLIGHT_KEEP:
                _inflight.pop(w, None)
        _inflight[wallet.lower()] = {
            "turnId": turn_id, "message": message, "started": time.time(),
            "steps": [], "result": None, "done_ts": None,
        }
    return turn_id


def _turn_step(wallet, label):
    with _inflight_lock:
        t = _inflight.get(wallet.lower())
        if t:
            t["steps"].append(label)


def _turn_done(wallet, result):
    with _inflight_lock:
        t = _inflight.get(wallet.lower())
        if t:
            t["result"] = result
            t["done_ts"] = time.time()


def turn_status(wallet):
    with _inflight_lock:
        t = _inflight.get((wallet or "").lower())
        if not t:
            return {"turnId": None, "running": False}
        return {
            "turnId": t["turnId"],
            "running": t["done_ts"] is None,
            "message": t["message"],
            "steps": list(t["steps"]),
            "result": t["result"],
            "ageS": round(time.time() - t["started"], 1),
        }

# ── subscription headroom ────────────────────────────────────────────────────
# Headroom comes from the agent's router module: `modules/router/env --status`
# prints one JSON object with the best plan's utilization (best.pct) and the
# last usage-endpoint reply (endpoint.status / endpoint.retry_after). The
# router owns all endpoint discipline — on-disk TTL cache, per-org pooling,
# the expired-token guard — so the bridge never touches the (undocumented,
# hard-rate-limited: 429 + Retry-After ~20min observed 2026-07-31) endpoint
# itself, and each --status call is a fresh interpreter (which is what the
# old in-process probe's subprocess fallback existed to get). We still
# refresh in a background thread (a slow probe holding the lock once froze
# /health long enough to false-page "down"), honor retry_after before asking
# again, and keep serving the last good reading while rate-limited so the
# exhaustion gate isn't blind during the back-off.
HEADROOM_TTL = float(os.environ.get("BRIDGE_HEADROOM_TTL", "300"))
HEADROOM_BACKOFF = float(os.environ.get("BRIDGE_HEADROOM_BACKOFF", "900"))
HEADROOM_STALE_OK = float(os.environ.get("BRIDGE_HEADROOM_STALE_OK", "2700"))
ROUTER_ENV = os.path.join(AGENT_HOME, "modules", "router", "env")
_headroom = {"pct": None, "good_ts": 0.0, "next_probe": 0.0, "refreshing": False}
_headroom_lock = threading.Lock()


def _router_status():
    """One `env --status` JSON object, or {} when the module is missing or
    broken. Run through our interpreter so a lost exec bit can't blind us."""
    try:
        r = subprocess.run([sys.executable, ROUTER_ENV, "--status"],
                           capture_output=True, text=True, timeout=60)
        data = json.loads((r.stdout or "").strip() or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _refresh_headroom():
    """Ask the router for the best plan; runs in a daemon thread, one in flight."""
    best = None
    endpoint = {}
    try:
        st = _router_status()
        b = st.get("best")
        if isinstance(b, dict) and isinstance(b.get("pct"), (int, float)):
            best = float(b["pct"])
        if isinstance(st.get("endpoint"), dict):
            endpoint = st["endpoint"]
    finally:
        now = time.time()
        with _headroom_lock:
            _headroom["refreshing"] = False
            if best is not None:
                _headroom.update(pct=best, good_ts=now,
                                 next_probe=now + HEADROOM_TTL)
            else:
                try:
                    retry_after = float(endpoint.get("retry_after") or 0)
                except (TypeError, ValueError):
                    retry_after = 0.0
                wait = max(HEADROOM_BACKOFF, retry_after)
                _headroom["next_probe"] = now + wait
                if endpoint.get("status") == 429:
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

# Tools the /requote endpoint may run directly (deterministic re-builds only —
# they read chain state and emit calldata, never spend or sign anything).
REQUOTE_TOOLS = {"buildUniV4Swap", "buildRoute"}


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


def _looks_like_writeup(event):
    """True when an assistant event starts emitting the final contract JSON."""
    if event.get("type") != "assistant":
        return False
    return any(
        isinstance(b, dict) and b.get("type") == "text" and (b.get("text") or "").lstrip().startswith("{")
        for b in ((event.get("message") or {}).get("content") or [])
    )


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
        # Reattach point for a reloaded page: what is (or was just) running for
        # this wallet, including the finished result.
        if self.path.split("?")[0].rstrip("/") == "/intent/status":
            if not secrets.compare_digest(self.headers.get("X-Bridge-Secret", ""), SECRET):
                return self._json(401, {"error": "unauthorized"})
            from urllib.parse import parse_qs, urlparse
            wallet = (parse_qs(urlparse(self.path).query).get("wallet") or [""])[0]
            if not wallet:
                return self._json(400, {"error": "wallet required"})
            return self._json(200, turn_status(wallet))
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
        self.send_header("X-Accel-Buffering", "no")     # nginx must not buffer SSE
        self.end_headers()
        # No Content-Length: EOF is the only end-of-body marker. Keeping the
        # socket alive after the final event left downstream readers waiting
        # until a 240s timeout — the "result shows up 4 minutes late" bug.
        self.close_connection = True

        seen = []
        broken = {"pipe": False}
        user_message = (body.get("message") or "").strip()
        turn_id = _turn_start(address, user_message)
        try:
            self._sse({"type": "start", "turnId": turn_id})
        except (BrokenPipeError, ConnectionResetError):
            broken["pipe"] = True

        def on_event(event):
            step = step_from_event(event)
            if not step:
                # The final answer is a JSON object the model writes after its
                # last tool call — 10-20s of otherwise-invisible work. Surface it
                # once so the step list never looks hung at the end.
                if seen and "__writeup" not in seen and _looks_like_writeup(event):
                    seen.append("__writeup")
                    label = "Putting the answer together"
                    _turn_step(address, label)
                    if not broken["pipe"]:
                        try:
                            self._sse({"type": "step", "tool": "__writeup", "label": label, "n": len(seen)})
                        except (BrokenPipeError, ConnectionResetError):
                            broken["pipe"] = True
                return
            seen.append(step["tool"])
            _turn_step(address, step["label"])      # recorded even if nobody's listening
            if broken["pipe"]:
                return
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
            _turn_done(address, {"type": "chat", "message": f"Something went wrong: {str(e)[:200]}",
                                 "engine": "claude-p"})
            if not broken["pipe"]:
                self._sse({"type": "error", "error": str(e)[:300]})
            return

        dt = time.time() - t0
        response = finish_turn(text, address, user_message, body.get("context") or "", dt)
        _turn_done(address, response)               # collectable after a reload
        print(f"[stream] {address[:10]}… {len(seen)} steps, "
              f"{response.get('type') if response else 'empty'} in {dt:.1f}s"
              f"{' (client gone)' if broken['pipe'] else ''}", flush=True)
        if not broken["pipe"]:
            self._sse({"type": "done", "turnId": turn_id, "result": response} if response
                      else {"type": "error", "error": "empty reply from agent"})

    def do_POST(self):
        path = self.path.rstrip("/")
        if path not in ("/intent", "/intent/stream", "/requote"):
            return self._json(404, {"error": "not found"})
        if not secrets.compare_digest(
                self.headers.get("X-Bridge-Secret", ""), SECRET):
            return self._json(401, {"error": "unauthorized"})

        # /requote runs one whitelisted wallet.mjs tool directly — no agent
        # turn, so no headroom gate or turn slot. This is how a transaction
        # card refreshes its price in ~2s instead of another full agent turn.
        if path == "/requote":
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(min(length, 65536)) or b"{}")
            except Exception:
                return self._json(400, {"error": "bad json"})
            tool = body.get("tool")
            args = body.get("args")
            if tool not in REQUOTE_TOOLS or not isinstance(args, dict):
                return self._json(400, {"error": "unsupported requote"})
            try:
                proc = subprocess.run(
                    ["node", os.path.join("tools", "wallet.mjs"), tool, json.dumps(args)],
                    cwd=BRAIN, capture_output=True, text=True, timeout=45,
                )
                result = json.loads(proc.stdout)
            except subprocess.TimeoutExpired:
                return self._json(504, {"error": "requote timed out"})
            except Exception as e:  # noqa: BLE001
                print(f"[requote] failed: {e}", flush=True)
                return self._json(502, {"error": "requote failed"})
            return self._json(200, result)

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
