#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/talk-video/app"
DATA_ROOT="/opt/talk-video/data"

set -a
source "$APP_ROOT/.env"
set +a
: "${TALK_VIDEO_ACCOUNT:?TALK_VIDEO_ACCOUNT must be set in .env}"
: "${TALK_VIDEO_SERIES:?TALK_VIDEO_SERIES must be set in .env}"

cd "$APP_ROOT"
mkdir -p "$DATA_ROOT/jobs" "$DATA_ROOT/draft"

cd "$APP_ROOT"
if [ -e node_modules ] && [ -n "$(find node_modules ! -user "$(id -u)" -print -quit)" ]; then
  cat >&2 <<'EOF'
Cannot update node_modules: it contains files not owned by the deploy user.
Run this once as root:
  chown -R deploy:deploy /opt/talk-video/app/node_modules
Then run the deployment again. Do not run npm commands as root.
EOF
  exit 1
fi
npm ci
npm run profile:sync
if [ -e .next ] && [ ! -w .next ]; then
  cat >&2 <<'EOF'
Cannot clean .next: it is not writable by the deploy user.
Run this once as root:
  chown -R deploy:deploy /opt/talk-video/app/.next
Then run the deployment again. Do not run Next.js builds as root.
EOF
  exit 1
fi
rm -rf .next
npm run lint
NODE_OPTIONS="--max-old-space-size=1024" npm run build

sudo /usr/bin/systemctl restart talk-video
for _ in $(seq 1 20); do
  if curl --fail --silent --show-error http://127.0.0.1:3100/api/health >/dev/null; then
    echo "Video is healthy"
    exit 0
  fi
  sleep 1
done

echo "Video did not become healthy" >&2
sudo /usr/bin/systemctl --no-pager --full status talk-video || true
exit 1
