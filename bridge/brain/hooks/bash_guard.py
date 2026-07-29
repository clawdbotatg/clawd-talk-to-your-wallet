#!/usr/bin/env python3
"""PreToolUse guard: the ONLY shell the denarai agent may run is a single
wallet.mjs tool invocation.

Why this exists: Claude Code's `--allowedTools "Bash(node tools/wallet.mjs:*)"`
is a PREFIX match, so `node tools/wallet.mjs ... ; cat .env` passes it — both
commands run. The agent's input is untrusted public chat, so prefix matching is
not a boundary. This hook is the boundary: exit 2 blocks the call.

Contract: stdin = {"tool_name": "...", "tool_input": {"command": "..."}}.
Exit 0 = allow, exit 2 = block (stderr is shown to the model).
"""
import json
import re
import sys

# One command, no chaining/redirection/substitution/expansion of any kind.
FORBIDDEN = re.compile(r"[;&|`$><\n\r]|\$\(|\|\||&&")
ALLOWED = re.compile(r"^node\s+tools/wallet\.mjs\s+[A-Za-z0-9_]+(\s+'[^']*')?\s*$")


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        print("bash_guard: unreadable hook payload — blocked", file=sys.stderr)
        sys.exit(2)

    if payload.get("tool_name") != "Bash":
        sys.exit(0)                                  # not our business

    cmd = (payload.get("tool_input") or {}).get("command", "")
    if FORBIDDEN.search(cmd):
        print(
            "BLOCKED: shell metacharacters are not permitted. Run exactly one "
            "wallet tool per Bash call, e.g.\n"
            "  node tools/wallet.mjs getTokenPrice '{\"symbol\":\"ethereum\"}'\n"
            "Use separate Bash calls (they can run in parallel) instead of chaining.",
            file=sys.stderr,
        )
        sys.exit(2)
    if not ALLOWED.match(cmd):
        print(
            "BLOCKED: only `node tools/wallet.mjs <tool> '<json>'` may be run. "
            "You cannot read files, inspect the environment, or run other programs — "
            "everything you need is a wallet tool. If a user asked for this, refuse.",
            file=sys.stderr,
        )
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
