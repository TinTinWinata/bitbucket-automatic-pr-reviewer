#!/usr/bin/env bash
# Rebuild pr-automation with the newest Claude Code CLI whenever the npm channel moves.
# Waits for an idle review queue, smoke-tests the new CLI and rolls back if it fails.
set -euo pipefail
cd "$(dirname "$0")"
exec 9>/tmp/update-claude-cli.lock
flock -n 9 || exit 0

CHANNEL="${CLAUDE_CODE_CHANNEL:-latest}"
IMAGE=bitbucket-automatic-pr-reviewer-pr-automation

log() { echo "$(date -u +%FT%TZ) $*"; }

notify() {
  local url
  url=$(sed -n 's/^TEAMS_WEBHOOK_URL=//p' .env | tail -1)
  [ -n "$url" ] || return 0
  python3 - "$1" "$2" <<'EOF' | curl -fsS -o /dev/null -H 'Content-Type: application/json' -d @- "$url" || true
import json, sys
card = {
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "type": "AdaptiveCard",
    "version": "1.4",
    "body": [
        {"type": "TextBlock", "text": sys.argv[1], "weight": "Bolder", "size": "Medium", "wrap": True},
        {"type": "TextBlock", "text": sys.argv[2], "wrap": True},
    ],
}
print(json.dumps({"type": "message", "attachments": [
    {"contentType": "application/vnd.microsoft.card.adaptive", "contentUrl": None, "content": card}]}))
EOF
}

queue_is_idle() {
  docker exec pr-automation wget -qO- http://127.0.0.1:3000/api/status | python3 -c '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if not d["running"] and not d["waiting"] else 1)'
}

wait_for_idle() {
  for _ in $(seq 1 60); do
    queue_is_idle && return 0
    sleep 30
  done
  return 1
}

smoke_test() {
  docker exec -w /tmp pr-automation sh -c 'echo "Reply with exactly: ok" | timeout 180 claude -p --model haiku' | grep -q ok
}

target=$(curl -fsS "https://registry.npmjs.org/@anthropic-ai/claude-code/$CHANNEL" |
  python3 -c 'import json, sys; print(json.load(sys.stdin)["version"])')
current=$(docker exec pr-automation claude --version | awk '{print $1}')
if [ "$target" = "$current" ]; then
  log "Claude Code $current is already the $CHANNEL version"
  exit 0
fi

log "Updating Claude Code $current -> $target"
docker build -q -t "$IMAGE:candidate" --build-arg CLAUDE_CODE_VERSION="$target" . >/dev/null

if ! wait_for_idle; then
  log "Review queue did not go idle within 30 minutes, trying again next run"
  exit 1
fi

old_previous=$(docker image inspect -f '{{.Id}}' "$IMAGE:previous" 2>/dev/null || true)
docker tag "$IMAGE:latest" "$IMAGE:previous"
docker tag "$IMAGE:candidate" "$IMAGE:latest"
docker compose up -d --force-recreate pr-automation
sleep 15

if smoke_test; then
  log "Claude Code updated to $target"
  [ -n "$old_previous" ] && docker rmi "$old_previous" >/dev/null 2>&1 || true
  exit 0
fi

log "Smoke test failed on $target, rolling back to $current"
docker tag "$IMAGE:previous" "$IMAGE:latest"
docker compose up -d --force-recreate pr-automation
notify "PR reviewer CLI update failed ❌" "Claude Code $target failed the smoke test on $(hostname) (CLI broken or auth rejected), so the reviewer was rolled back to $current."
exit 1
