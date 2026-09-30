#!/usr/bin/env bash
# Builds and tests inside Docker; the host needs only Docker.
#
#   ./build.sh          install deps, typecheck, unit tests, build
#   ./build.sh test     unit tests only
#   ./build.sh image    production image semantic-scholar-bridge:<version>
#   ./build.sh shell    interactive shell in the build container
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p logs
exec > >(tee logs/build.log) 2>&1
echo "== $(date -Is) $0 $*"

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then DOCKER=(sudo docker); fi
IMAGE=semantic-scholar-bridge-dev:node22
"${DOCKER[@]}" build -q -t "$IMAGE" -f docker/Dockerfile.dev docker/ >/dev/null

run() {
  "${DOCKER[@]}" run --rm "${TTY[@]}" -u "$(id -u):$(id -g)" \
    -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e npm_config_update_notifier=false \
    -v "$PWD":/src -w /src "$IMAGE" bash -c "$1"
}
TTY=()
DEPS='if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi'
VERSION=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' package.json | head -1)

case "${1:-all}" in
  all)   run "$DEPS && npm run check && npm test && npm run build" ;;
  test)  run "$DEPS && npm test" ;;
  image) "${DOCKER[@]}" build -t "semantic-scholar-bridge:$VERSION" -t semantic-scholar-bridge:latest . ;;
  shell) TTY=(-it); run "$DEPS; bash" ;;
  *) echo "usage: $0 [all|test|image|shell]" >&2; exit 2 ;;
esac
