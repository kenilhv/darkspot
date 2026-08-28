#!/usr/bin/env bash
# Brings up everything the demo needs, locally, and reports what is actually reachable.
# Run from the repo root:  bash scripts/demo-up.sh
#
# Surfaces after this finishes:
#   http://localhost:5200        landing page -> coordinator, sim (one entry point)
#   http://localhost:3080        LibreChat (grounded chat, guarded)
#   ClickHouse Cloud console     browser, database `darkspot`
#
# Databases are ClickHouse Cloud + Postgres Cloud (see .env), not the local docker spine.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
CHAT_DIR="$ROOT/../darkspot-chat/apps/chat/librechat"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32mok\033[0m   %s\n' "$*"; }
bad() { printf '  \033[31mDOWN\033[0m %s\n' "$*"; }

say "1. Rebuilding the unified site"
node scripts/build-site.mjs >/dev/null 2>&1 && ok "site/ rebuilt from the design + swarm worktrees" \
  || bad "build-site.mjs failed — run it directly to see why"

say "2. Static site on :5200"
if curl -sf -o /dev/null http://localhost:5200/; then
  ok "already serving"
else
  (npx --yes serve -l 5200 site >/dev/null 2>&1 &)
  sleep 4
  curl -sf -o /dev/null http://localhost:5200/ && ok "started" || bad "did not come up"
fi

say "3. LibreChat stack (docker)"
if curl -sf -o /dev/null http://localhost:3080/; then
  ok "already serving"
else
  ( cd "$CHAT_DIR" && docker compose up -d >/dev/null 2>&1 )
  sleep 8
  curl -sf -o /dev/null http://localhost:3080/ && ok "started" || bad "did not come up — check: docker compose -f $CHAT_DIR/docker-compose.yml logs"
fi

say "4. Reachability check"
for u in \
  "http://localhost:5200/               landing" \
  "http://localhost:5200/coordinator/   coordinator view" \
  "http://localhost:5200/sim/           swarm simulation" \
  "http://localhost:3080/               LibreChat"
do
  url=${u%% *}; label=${u#* }
  code=$(curl -s -o /dev/null -w '%{http_code}' "$url")
  [ "$code" = "200" ] && ok "$code  $label  $url" || bad "$code  $label  $url"
done

say "5. Live cloud data (the claim the demo rests on)"
if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
  rows=$(curl -s --user "default:${CLICKHOUSE_PASSWORD}" \
    --data-binary "SELECT count() FROM darkspot.priority_rank" "${CLICKHOUSE_URL}" 2>/dev/null)
  top=$(curl -s --user "default:${CLICKHOUSE_PASSWORD}" \
    --data-binary "SELECT settlement_name, round(silence_hours,2) FROM darkspot.priority_rank ORDER BY rank LIMIT 1" "${CLICKHOUSE_URL}" 2>/dev/null)
  if [ -n "$rows" ]; then ok "ClickHouse Cloud: $rows ranked rows · rank 1 = $top"
  else bad "ClickHouse Cloud unreachable"; fi
else
  bad ".env not found — cloud checks skipped"
fi

printf '\n\033[1mOpen this one URL:\033[0m  http://localhost:5200\n\n'
