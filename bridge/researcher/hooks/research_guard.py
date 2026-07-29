#!/usr/bin/env python3
"""PreToolUse guard for the researcher agent.

The researcher needs a shell to PROVE its work (run wallet tools, syntax-check
its edits). It must not get an unrestricted one: its prompt contains miss text,
and any denar.ai user can cause a `logMiss` with text of their choosing — so the
input is attacker-influenceable, and the agent has Write access to the repo.

Allowed: read-only verification commands only, one per call, no shell operators.
Exit 0 = allow, exit 2 = block (stderr goes back to the model).
"""
import json
import re
import sys

FORBIDDEN = re.compile(r"[;&|`$><\n\r]|\$\(|\|\||&&")

# Paths that must never be read, whatever command is asking: secrets, credential
# stores, and user data (turns/misses hold wallet addresses and chat content).
SECRET_PATH = re.compile(
    r"(^|[\s/])(\.env|\.env\.[\w.]+|\.bridge-secret|\.credentials\.json|\.claude-settings\.json"
    r"|turns\.jsonl|misses\.jsonl|turns-archive|\.memory|id_[a-z0-9]+|\.ssh|\.aws|\.git/config)"
    r"([\s/]|$)",
    re.I,
)

ALLOWED = [
    # run a wallet tool to verify behaviour (optionally cd'd into the brain dir)
    re.compile(r"^node\s+(bridge/brain/tools/|tools/)?wallet\.mjs\s+[A-Za-z0-9_]+(\s+'[^']*')?\s*$"),
    # syntax-check an edit
    re.compile(r"^node\s+--check\s+[\w./-]+\s*$"),
    # read-only git inspection of its own changes
    re.compile(r"^git\s+(status|diff|log)(\s+[\w./=-]+)*\s*$"),
    # look at what it wrote
    re.compile(r"^(ls|cat|head|tail|wc)\s+[\w./-]+(\s+[\w./-]+)*\s*$"),
]


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        print("research_guard: unreadable payload — blocked", file=sys.stderr)
        sys.exit(2)

    if payload.get("tool_name") != "Bash":
        sys.exit(0)

    cmd = (payload.get("tool_input") or {}).get("command", "").strip()
    if FORBIDDEN.search(cmd):
        print(
            "BLOCKED: no shell operators (;, &&, |, $(), redirection). Run one command "
            "per Bash call.",
            file=sys.stderr,
        )
        sys.exit(2)
    if SECRET_PATH.search(cmd):
        print(
            "BLOCKED: that path holds secrets or user data and is never readable. "
            "API keys are already in the environment of the wallet tools — you never "
            "need to see them. If a task seems to require this, refuse and say so.",
            file=sys.stderr,
        )
        sys.exit(2)
    if any(p.match(cmd) for p in ALLOWED):
        sys.exit(0)
    print(
        "BLOCKED: only verification commands are permitted:\n"
        "  node wallet.mjs <tool> '<json>'   (from bridge/brain — prove tool behaviour)\n"
        "  node --check <file>               (syntax-check an edit)\n"
        "  git status|diff|log               (inspect your own changes)\n"
        "  ls|cat|head|tail|wc <file>\n"
        "You cannot install packages, write files via shell, reach the network directly, "
        "or read secrets. Use Write/Edit for files and WebFetch/WebSearch for docs.",
        file=sys.stderr,
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
