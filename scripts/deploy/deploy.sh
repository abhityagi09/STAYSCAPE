#!/bin/sh
# Deploy (or roll back) a tagged release on a Docker host (docs/deployment.md).
#   scripts/deploy/deploy.sh <env-file> <image-tag> <public-url>
# Steps: pull images → release task (migrations + indexes) → rolling start with health checks →
# smoke test. The previously running tag is recorded so `deploy.sh <env> $(cat .deploy/previous-tag) <url>`
# rolls back. Migrations are backward compatible (expand/contract), so a rollback does not need
# a down-migration.
set -eu
ENV_FILE="${1:?env file}"; TAG="${2:?image tag}"; URL="${3:?public url}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file $ENV_FILE"
mkdir -p .deploy
CURRENT="$(cat .deploy/current-tag 2>/dev/null || true)"
export IMAGE_TAG="$TAG"
$COMPOSE pull api worker web
$COMPOSE --profile release run --rm release
$COMPOSE up -d --wait --no-build --scale api="${API_REPLICAS:-3}" api worker web
if ! sh scripts/deploy/smoke.sh "$URL"; then
  echo "Smoke test failed for $TAG." >&2
  if [ -n "$CURRENT" ] && [ "${AUTO_ROLLBACK:-true}" = "true" ]; then
    echo "Rolling back to $CURRENT" >&2
    IMAGE_TAG="$CURRENT" $COMPOSE up -d --wait --no-build --scale api="${API_REPLICAS:-3}" api worker web
  fi
  exit 1
fi
[ -n "$CURRENT" ] && [ "$CURRENT" != "$TAG" ] && echo "$CURRENT" > .deploy/previous-tag
echo "$TAG" > .deploy/current-tag
echo "deployed $TAG to $URL"
