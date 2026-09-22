#!/usr/bin/env bash
# turns.jsonl is the training corpus and it only exists on this box. Rotate it so
# it can't grow unbounded, and keep a dated copy so a bad deploy or a full disk
# can't erase months of conversations.
#
# Rotates when the live file exceeds MAX_MB; keeps KEEP_DAYS of archives.
set -uo pipefail

BRIDGE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$BRIDGE/turns.jsonl"
ARCHIVE="$BRIDGE/turns-archive"
MAX_MB="${TURNS_MAX_MB:-64}"
KEEP_DAYS="${TURNS_KEEP_DAYS:-36500}"   # the corpus is kept forever

[ -f "$SRC" ] || exit 0
mkdir -p "$ARCHIVE"

size_mb=$(( $(stat -c %s "$SRC" 2>/dev/null || stat -f %z "$SRC") / 1048576 ))
stamp=$(date -u +%Y%m%dT%H%M%SZ)

# Always keep a compressed daily snapshot (cheap; jsonl compresses ~10x).
daily="$ARCHIVE/turns-$(date -u +%F).jsonl.gz"
[ -f "$daily" ] || gzip -c "$SRC" > "$daily"

if [ "$size_mb" -ge "$MAX_MB" ]; then
  # Move aside, then truncate in place so the running service's open handle
  # keeps working (it appends by path each write, so this is safe either way).
  cp "$SRC" "$ARCHIVE/turns-$stamp.jsonl" && gzip -f "$ARCHIVE/turns-$stamp.jsonl" && : > "$SRC"
  echo "$(date -u +%FT%TZ) rotated at ${size_mb}MB → turns-$stamp.jsonl.gz" >> "$BRIDGE/ops-alerts.log"
fi

find "$ARCHIVE" -name 'turns-*.jsonl.gz' -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true

# The session transcripts (every tool call and result, per wallet) are the
# "how" behind turns.jsonl. They live in claude's own store, which purges them
# after cleanupPeriodDays; the bridge sets that to 100 years, and this copy is
# the belt to that brace — a fresh login dir or a CLI default change can't
# take the history with it. Same file names; newer source overwrites.
TRANSCRIPTS="$BRIDGE/transcripts-archive"
mkdir -p "$TRANSCRIPTS"
for store in "$HOME/.claude/projects" "$HOME"/.clawd-accounts/*/projects; do
  [ -d "$store" ] || continue
  for src in "$store"/*bridge-brain*/*.jsonl; do
    [ -f "$src" ] || continue
    cp -p -u "$src" "$TRANSCRIPTS/" 2>/dev/null || true   # -u: a resumed session's file keeps growing
  done
done
