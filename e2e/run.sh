#!/usr/bin/env bash
# E2E tests: builds the production image and runs it against mocks (Docker Compose).
# Output: logs/e2e.log (bridge log included).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
exec > >(tee logs/e2e.log) 2>&1
echo "== $(date -Is) $0 $*"

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then DOCKER=(sudo docker); fi
COMPOSE=("${DOCKER[@]}" compose -p s2bridge-e2e -f e2e/docker-compose.yml)

"${COMPOSE[@]}" build --quiet bridge
status=0
"${COMPOSE[@]}" run --rm tests || status=$?
echo "== bridge log"
"${COMPOSE[@]}" logs --no-color bridge | tail -40
"${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1
exit $status
