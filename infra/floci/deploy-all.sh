#!/usr/bin/env bash
# Floci deploy for the whole Food Bank project (all three services, one local AWS).
# Run from the repo root, with Docker running:  bash infra/floci/deploy-all.sh
# Secrets are read from each service's ignored .env file or from your shell. Nothing is printed or stored here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"

# The first Lambda create/update makes Floci pull and start a runtime, which can take minutes.
# Put a tiny wrapper first on PATH so every AWS CLI call waits instead of timing out at 60 seconds.
REAL_AWS="$(command -v aws || true)"
SHIM_DIR="$(mktemp -d)"
if [ -n "$REAL_AWS" ]; then
  printf '#!/usr/bin/env bash\nexec "%s" --cli-read-timeout 0 "$@"\n' "$REAL_AWS" > "$SHIM_DIR/aws"
  chmod +x "$SHIM_DIR/aws"
  export PATH="$SHIM_DIR:$PATH"
fi
trap 'rm -rf "$SHIM_DIR"' EXIT

command -v aws >/dev/null || { echo "Install the AWS CLI first."; exit 1; }
command -v docker >/dev/null || { echo "Install Docker first."; exit 1; }

echo "== 1/4 Start Floci"
docker compose -f "$ROOT/infra/floci/compose.yaml" up -d
for i in $(seq 1 30); do
  curl -s -o /dev/null "$AWS_ENDPOINT_URL" && break
  sleep 2
done

loadenv() { set -a; . "$ROOT/services/$1/.env"; set +a; }

# Updating an existing Lambda is slow and can fail to verify on Floci, so start from a clean slate.
# This only touches the local Floci emulator, never real AWS.
for FN in mohamed-inventory-api momen-distribution-api; do
  aws lambda delete-function --function-name "$FN" >/dev/null 2>&1 || true
done

echo "== 2/4 Inventory service (Lambda, API Gateway, S3 export bucket, secret)"
( loadenv inventory-service && bash "$ROOT/infra/floci/build-inventory-lambda.sh" && bash "$ROOT/infra/floci/setup-mohamed.sh" )

echo "== 3/4 Distribution + login service (Lambda + API Gateway)"
( cd "$ROOT/services/distribution-service" && bash infra/floci/setup-momen.sh )

echo "== 4/4 Alerts + reporting service (Lambda, API Gateway, S3, scheduler, CloudWatch)"
( cd "$ROOT/services/alerts-reporting-service" && npm install --silent && npm run floci:deploy )

echo
echo "All three setups finished. Copy each printed API URL into frontend/js/config.js (SERVICES)."
