#!/usr/bin/env bash
# Alert when the denarai agent can't serve. Runs from cron; alerts are
# rate-limited to one per ALERT_COOLDOWN seconds per condition so a long outage
# doesn't spam.
#
# Alerting is via a webhook (ALERT_WEBHOOK in bridge/.env — Slack/Discord/ntfy
# style JSON {"text": ...}). With no webhook set it still logs to
# bridge/ops-alerts.log, so `tail` is a valid low-tech monitor.
set -uo pipefail

BRIDGE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$BRIDGE/ops-alerts.log"
STATE="$BRIDGE/.ops-alert-state"

# shellcheck disable=SC1090
[ -f "$BRIDGE/.env" ] && set -a && . "$BRIDGE/.env" && set +a

PORT="${BRIDGE_PORT:-8793}"
now=$(date +%s)
mkdir -p "$(dirname "$STATE")"; touch "$STATE"

note() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$1" >> "$LOG"; }

alert() {                       # alert <key> <message>
  # Cooldown read at CALL time so a per-call override (ALERT_COOLDOWN=86400
  # alert …) and a .env-set value both actually apply — a top-of-script capture
  # ran before .env loaded and froze overrides out, paging noauth hourly.
  local key="$1" msg="$2" last cool="${ALERT_COOLDOWN:-3600}"
  last=$(grep "^$key " "$STATE" 2>/dev/null | tail -1 | awk '{print $2}')
  if [ -n "${last:-}" ] && [ $((now - last)) -lt "$cool" ]; then
    note "SUPPRESSED($key): $msg"; return
  fi
  grep -v "^$key " "$STATE" > "$STATE.tmp" 2>/dev/null || true
  printf '%s %s\n' "$key" "$now" >> "$STATE.tmp"; mv "$STATE.tmp" "$STATE"
  note "ALERT($key): $msg"

  # Telegram: reuse the controller bot already on this box (no new bot needed).
  # Token/chat id come from ~/clawd-harness/.env.controller unless overridden.
  local tg_token="${ALERT_TELEGRAM_TOKEN:-}" tg_chat="${ALERT_TELEGRAM_CHAT:-}"
  local ctl="$HOME/clawd-harness/.env.controller"
  if [ -z "$tg_token" ] && [ -f "$ctl" ]; then
    tg_token=$(sed -n 's/^CONTROLLER_TELEGRAM_TOKEN=//p' "$ctl" | tr -d '"' | head -1)
    # CONTROLLER_TELEGRAM_ALLOW is a comma/space list of allowed chat ids
    [ -z "$tg_chat" ] && tg_chat=$(sed -n 's/^CONTROLLER_TELEGRAM_ALLOW=//p' "$ctl" \
      | tr -d '"' | tr ', ' '\n' | grep -E '^-?[0-9]+$' | head -1)
  fi
  if [ -n "$tg_token" ] && [ -n "$tg_chat" ]; then
    curl -fsS -m 15 "https://api.telegram.org/bot${tg_token}/sendMessage" \
      --data-urlencode "chat_id=${tg_chat}" \
      --data-urlencode "text=⚠️ denarai agent (zkllmapi): ${msg}" >/dev/null 2>&1 \
      || note "telegram post failed"
  fi

  if [ -n "${ALERT_WEBHOOK:-}" ]; then
    curl -fsS -m 15 -X POST "$ALERT_WEBHOOK" -H 'Content-Type: application/json' \
      --data "$(printf '{"text":"denarai bridge: %s"}' "$msg")" >/dev/null 2>&1 \
      || note "webhook post failed"
  fi
}

# 1. is the service up and answering?
health=$(curl -fsS -m 10 "http://127.0.0.1:$PORT/health" 2>/dev/null)
if [ -z "$health" ]; then
  active=$(systemctl is-active denarai-bridge 2>/dev/null || echo unknown)
  alert down "/health not answering on :$PORT (systemd: $active). denar.ai is falling back to Bankr."
  exit 0
fi

# 2. would it actually serve, or is it refusing every request?
verdict=$(python3 -c "
import json,sys
try: h=json.loads(sys.argv[1])
except Exception: print('BADJSON'); raise SystemExit
pct=h.get('headroomPct')
if h.get('loggedIn') is False: print('NOLOGIN'); raise SystemExit
print('NOSERVE' if not h.get('wouldServe') else 'NOAUTH' if pct is None else f'OK {pct}')
" "$health")

# 2b. how old is each login? They die ~30 days after each sign-in, so warn a
# human while there is still time to re-sign calmly. One clock per slot: the
# default ~/.claude login plus every ~/.clawd-accounts/<name> the router can
# pick. `login_since_<slot>` is the first tick that saw the slot logged in
# after it was not — i.e. the sign-in ceremony; it resets when the slot dies.
slot_status() {          # slot_status <name> <config_dir|"">  → True/False/None
  if [ -n "$2" ]; then CLAUDE_CONFIG_DIR="$2" claude auth status 2>/dev/null
  else claude auth status 2>/dev/null; fi | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('loggedIn'))
except Exception: print('None')"
}
slots="default|"
for d in "$HOME"/.clawd-accounts/*/; do
  [ -d "$d" ] && slots="$slots
$(basename "$d")|$d"
done
alive=0; dead=""
while IFS='|' read -r name dir; do
  [ -n "$name" ] || continue
  st=$(slot_status "$name" "$dir")
  since=$(grep "^login_since_$name " "$STATE" 2>/dev/null | tail -1 | awk '{print $2}')
  if [ "$st" = "True" ]; then
    alive=$((alive + 1))
    if [ -z "${since:-}" ]; then
      printf 'login_since_%s %s\n' "$name" "$now" >> "$STATE"; since=$now
      note "login $name observed alive — aging clock starts"
    fi
    age_d=$(( (now - since) / 86400 ))
    if [ "$age_d" -ge "${LOGIN_WARN_DAYS:-25}" ]; then
      relogin="claude auth login"; [ -n "$dir" ] && relogin="CLAUDE_CONFIG_DIR=~/.clawd-accounts/$name claude auth login"
      ALERT_COOLDOWN=86400 alert "loginaging_$name" \
        "login '$name' is ${age_d} days old — they die at ~30. Re-sign before it takes denar.ai down: ssh -t zkllmapi   then   $relogin"
    fi
  elif [ "$st" = "False" ]; then
    dead="$dead $name"
    if [ -n "${since:-}" ]; then
      grep -v "^login_since_$name " "$STATE" > "$STATE.tmp" 2>/dev/null || true; mv "$STATE.tmp" "$STATE"
    fi
  fi
done <<< "$slots"
# A dead slot while others still serve: the router falls through to a sibling,
# so this is a warning, not the outage above — one page a day per slot.
for name in $dead; do
  [ "$alive" -gt 0 ] || break
  relogin="claude auth login"; [ "$name" != default ] && relogin="CLAUDE_CONFIG_DIR=~/.clawd-accounts/$name claude auth login"
  ALERT_COOLDOWN=86400 alert "slotdead_$name" \
    "login '$name' is DEAD ($alive other(s) still serving). Re-sign: ssh -t zkllmapi   then   $relogin"
done

case "$verdict" in
  # The claude login on this box is dead (they die ~30 d after each sign-in).
  # Every turn fails; the bridge 503s and denar.ai runs on Bankr until a human
  # signs in again. This is the outage that hid for three weeks (2026-08-26 →
  # 09-15) behind the softer noauth note below — page it, 4×/day.
  NOLOGIN) ALERT_COOLDOWN=21600 alert nologin \
             "claude login DEAD — agent refusing every turn, denar.ai is on Bankr fallback. Fix: ssh -t zkllmapi claude auth login   (then /health shows loggedIn:true)" ;;
  NOSERVE) alert noserve "refusing requests — subscription headroom exhausted (${health}). Users are on Bankr." ;;
  # Usage-unknown is NOT an outage: the agent still serves (wouldServe stays true)
  # and turns work — only the pre-emptive headroom gate is blind, so exhaustion
  # shows up as a failed turn that the Vercel route falls back to Bankr. Worth
  # knowing, not worth paging every 10 minutes.
  NOAUTH)  ALERT_COOLDOWN=86400 alert noauth \
             "headroom unreadable — agent still serving, but the exhaustion gate is blind. Check: ssh zkllmapi 'python3 ~/clawd-harness/tools/usage_probe.py'" ;;
  BADJSON) alert badjson "/health returned unparseable output" ;;
  *)       note "ok ($verdict)" ;;
esac
