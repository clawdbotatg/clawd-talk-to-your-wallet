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
COOLDOWN="${ALERT_COOLDOWN:-3600}"

# shellcheck disable=SC1090
[ -f "$BRIDGE/.env" ] && set -a && . "$BRIDGE/.env" && set +a

PORT="${BRIDGE_PORT:-8793}"
now=$(date +%s)
mkdir -p "$(dirname "$STATE")"; touch "$STATE"

note() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$1" >> "$LOG"; }

alert() {                       # alert <key> <message>
  local key="$1" msg="$2" last
  last=$(grep "^$key " "$STATE" 2>/dev/null | tail -1 | awk '{print $2}')
  if [ -n "${last:-}" ] && [ $((now - last)) -lt "$COOLDOWN" ]; then
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
print('NOSERVE' if not h.get('wouldServe') else 'NOAUTH' if pct is None else f'OK {pct}')
" "$health")

case "$verdict" in
  NOSERVE) alert noserve "refusing requests — subscription headroom exhausted (${health}). Users are on Bankr." ;;
  NOAUTH)  alert noauth  "usage endpoint unreadable — the box's claude login may be dead. Run: ssh zkllmapi claude /login" ;;
  BADJSON) alert badjson "/health returned unparseable output" ;;
  *)       note "ok ($verdict)" ;;
esac
