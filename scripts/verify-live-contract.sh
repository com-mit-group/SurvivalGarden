#!/usr/bin/env bash
set -euo pipefail

BACKEND_BASE_URL="${BACKEND_BASE_URL:-http://127.0.0.1:5142}"
OPENAPI_ARTIFACT_DIR="${OPENAPI_ARTIFACT_DIR:-.artifacts/openapi}"
OPENAPI_HOST="${OPENAPI_HOST:-127.0.0.1}"
OPENAPI_PORT="${OPENAPI_PORT:-5178}"
SELECTED_TESTS=(
  "src/data/index.cutoverRouting.test.ts"
  "src/data/repos/workflowRouting.test.ts"
)

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd python3
require_cmd pnpm
require_cmd git

mkdir -p "$OPENAPI_ARTIFACT_DIR"

OPENAPI_FETCH_URL="${BACKEND_BASE_URL%/}/openapi/v1.json"
OPENAPI_FILE="$OPENAPI_ARTIFACT_DIR/openapi-v1.json"
OPENAPI_SERVE_URL="http://${OPENAPI_HOST}:${OPENAPI_PORT}/openapi-v1.json"

echo "[1/4] Fetching backend OpenAPI: $OPENAPI_FETCH_URL"
curl -fsSL "$OPENAPI_FETCH_URL" -o "$OPENAPI_FILE"
echo "Saved: $OPENAPI_FILE"

echo "[2/4] Serving fetched OpenAPI at: $OPENAPI_SERVE_URL"
python3 -m http.server "$OPENAPI_PORT" --bind "$OPENAPI_HOST" --directory "$OPENAPI_ARTIFACT_DIR" >/tmp/survivalgarden-openapi-server.log 2>&1 &
OPENAPI_SERVER_PID=$!
cleanup() {
  if kill -0 "$OPENAPI_SERVER_PID" >/dev/null 2>&1; then
    kill "$OPENAPI_SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Give server a short warm-up window.
sleep 1

echo "[3/4] Regenerating frontend generated contract files"
BACKEND_OPENAPI_URL="$OPENAPI_SERVE_URL" REQUIRE_BACKEND_OPENAPI=1 pnpm --dir frontend gen:types

echo "Checking generated file drift"
git diff --exit-code -- \
  frontend/src/generated/contracts.ts \
  frontend/src/generated/openapi-paths.ts \
  frontend/src/generated/api-client.ts

echo "[4/4] Running selected backend-routing tests"
pnpm --dir frontend exec vitest run "${SELECTED_TESTS[@]}"

echo "✅ Live contract verification passed."
