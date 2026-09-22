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
from agent import run_turn, current_session, forget  # noqa: E402

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
        # Every wallet's transcript is the record of what the agent did — keep
        # it forever. claude's default purges transcripts after 30 days
        # (2026-09-22: the July/August tool-call history was already gone).
        "cleanupPeriodDays": 36500,
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


def log_failed_turn(body, err, dt, engine="claude-p"):
    """A turn that died still goes in the corpus — 'what did people ask and did
    they get it' can't be answered from successes alone (owner, 2026-09-22)."""
    log_turn({
        "wallet": (body.get("address") or "").strip(),
        "message": (body.get("message") or "").strip(),
        "context": body.get("context") or "",
        "raw_reply": None,
        "response": None,
        "contract": False,
        "error": str(err)[:2000],
        "duration_s": round(dt, 1),
        "engine": engine,
    })


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


# ── login liveness ───────────────────────────────────────────────────────────
# The box's claude login dies server-side ~30 days after each sign-in. When it
# does, every turn fails with an is_error result ("OAuth session expired and
# could not be refreshed") on stdout, stderr empty. From 2026-08-26 to
# 2026-09-15 the bridge kept accepting turns and every user saw "Something
# went wrong: claude exited 1:" — wouldServe only knew about headroom, and
# the healthcheck filed the symptom under "usage unreadable, not an outage".
# A dead login is a hard 503 now, so the Vercel route falls back to Bankr and
# users get an answer. Re-arm the box with: ssh -t zkllmapi claude auth login
AUTH_TTL = float(os.environ.get("BRIDGE_AUTH_TTL", "120"))
_auth = {"ok": None, "ts": 0.0, "next_probe": 0.0, "refreshing": False}
_auth_lock = threading.Lock()


def _slot_logged_in(config_dir=None):
    """One `claude auth status` for a login slot: True/False, or None when unreadable."""
    env = dict(os.environ)
    if config_dir:
        env["CLAUDE_CONFIG_DIR"] = config_dir
    try:
        r = subprocess.run(["claude", "auth", "status"], env=env,
                           capture_output=True, text=True, timeout=30)
        d = json.loads((r.stdout or "").strip() or "{}")
        v = d.get("loggedIn") if isinstance(d, dict) else None
        return v if isinstance(v, bool) else None
    except Exception:
        return None


def _claude_logged_in():
    """True if ANY login the router can pick is alive: the default ~/.claude
    plus every ~/.clawd-accounts/<name> slot (dead creds fall through to a
    sibling in the router). False only when every readable slot is dead."""
    dirs = [None]
    root = os.path.expanduser(os.environ.get("CLAWD_ACCOUNTS_DIR", "~/.clawd-accounts"))
    try:
        # `<name>.lock` siblings are lock artifacts, not logins — counting them
        # paged "login DEAD" daily per slot (2026-09-16 → 09-22).
        dirs += [os.path.join(root, n) for n in sorted(os.listdir(root))
                 if os.path.isdir(os.path.join(root, n)) and not n.endswith(".lock")]
    except OSError:
        pass
    seen = False
    for d in dirs:
        v = _slot_logged_in(d)
        if v:
            return True
        seen = seen or v is False
    return False if seen else None


def _refresh_auth():
    ok = _claude_logged_in()
    now = time.time()
    with _auth_lock:
        _auth["refreshing"] = False
        _auth["next_probe"] = now + AUTH_TTL
        if ok is None:
            return
        if ok is False and _auth["ok"] is not False:
            print("[auth] claude login is DEAD — refusing turns (503) so denar.ai "
                  "falls back to Bankr. Fix: claude auth login", flush=True)
        elif ok and _auth["ok"] is False:
            print("[auth] claude login restored — serving again", flush=True)
        _auth.update(ok=ok, ts=now)


def logged_in(block=False):
    """Cached login liveness (True/False/None=unknown). Refreshes in the
    background every AUTH_TTL; `block=True` (boot) waits for one reading."""
    if block:
        _refresh_auth()
        return _auth["ok"]
    now = time.time()
    with _auth_lock:
        if now >= _auth["next_probe"] and not _auth["refreshing"]:
            _auth["refreshing"] = True
            threading.Thread(target=_refresh_auth, daemon=True).start()
        return _auth["ok"]


def note_turn_error(err):
    """A turn that died on authentication closes the gate at once — the next
    request 503s instead of burning another failed turn until the TTL."""
    s = str(err).lower()
    if any(m in s for m in ("authenticate", "oauth", "not logged in", "/login")):
        with _auth_lock:
            _auth.update(ok=False, ts=time.time(), next_probe=time.time() + AUTH_TTL)
        print("[auth] turn failed on authentication — gate closed", flush=True)


def would_serve():
    pct = best_headroom_pct()
    if logged_in() is False:
        return False, pct
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
    "buildOrbitDeposit": "Building the canonical bridge deposit",
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
REQUOTE_TOOLS = {"buildUniV4Swap", "buildRoute", "buildOrbitDeposit"}


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


STALE_SESSION = "no conversation found"


def run_wallet_turn(body, **kw):
    """One remembered turn for a wallet, surviving a purged transcript.

    claude deletes transcripts after ~30 days (cleanupPeriodDays), but the
    wallet's `.session` file still names the old id, so `--resume` dies with
    "No conversation found with session ID" — every returning wallet, including
    the demo wallet on the home page, hard-failed for as long as the id stayed
    on disk. Forget the stale id and run the turn fresh (the frontend's rolling
    history then rides along, as for any new conversation)."""
    prompt, key, _address = build_prompt(body)
    try:
        return run_turn(prompt, remember=key, **kw)
    except RuntimeError as e:
        if STALE_SESSION not in str(e).lower():
            raise
        print(f"[session] {key} names a purged transcript — forgetting and retrying fresh", flush=True)
        forget(key)
        prompt, key, _address = build_prompt(body)
        return run_turn(prompt, remember=key, **kw)


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
    if not message or not address:
        return 400, {"type": "chat", "message": "message and address are required"}

    t0 = time.time()
    text = run_wallet_turn(
        body,
        auto_memory=False,          # per-wallet keys must not share facts
        input_via="stdin",          # context blocks can be large
        timeout=TURN_TIMEOUT,
        extra_args=turn_args(),
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
                "ok": True, "wouldServe": ok, "headroomPct": pct, "loggedIn": logged_in(),
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
            text = run_wallet_turn(
                body, auto_memory=False, input_via="stdin",
                on_event=on_event, extra_args=turn_args(),
            )
        except Exception as e:  # noqa: BLE001
            print(f"[stream] turn failed: {e}", flush=True)
            note_turn_error(e)
            log_failed_turn(body, e, time.time() - t0)
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
            li = logged_in()
            return self._json(503, {"error": "no-auth" if li is False else "no-headroom",
                                    "headroomPct": pct, "loggedIn": li})
        if not _turns.acquire(blocking=False):
            return self._json(503, {"error": "busy"})
        with _active_lock:
            _active["n"] += 1
        body, t_req = {}, time.time()
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            if path == "/intent/stream":
                self._stream_intent(body)        # logs its own failures
            else:
                code, obj = handle_intent(body)
                self._json(code, obj)
        except Exception as e:  # noqa: BLE001 — a failed turn must 500, route falls back
            print(f"[intent] error: {e}", flush=True)
            note_turn_error(e)
            if path != "/intent/stream":
                log_failed_turn(body, e, time.time() - t_req)
            try:
                self._json(500, {"error": str(e)})
            except Exception:
                pass
        finally:
            with _active_lock:
                _active["n"] -= 1
            _turns.release()


def main():
    li = logged_in(block=True)       # one synchronous reading so the gate is right from request #1
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
    print(f"  login: {'ok' if li else 'DEAD — every request 503s until `claude auth login`' if li is False else 'unknown'}", flush=True)
    print(f"  secret in {SECRET_FILE}" if not os.environ.get("BRIDGE_SECRET") else "  secret from env", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
