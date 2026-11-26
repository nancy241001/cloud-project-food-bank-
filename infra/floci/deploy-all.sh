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

# The first Lambda creation makes Floci pull a runtime image, which can take minutes.
# Give the AWS CLI no read timeout so it waits instead of failing.
AWS_TMP_CONFIG="$(mktemp)"
printf '[default]\ncli_read_timeout = 0\ncli_connect_timeout = 60\n' > "$AWS_TMP_CONFIG"
export AWS_CONFIG_FILE="$AWS_TMP_CONFIG"
trap 'rm -f "$AWS_TMP_CONFIG"' EXIT

command -v aws >/dev/null || { echo "Install the AWS CLI first."; exit 1; }
command -v docker >/dev/null || { echo "Install Docker first."; exit 1; }

echo "== 1/4 Start Floci"
docker compose -f "$ROOT/infra/floci/compose.yaml" up -d
for i in $(seq 1 30); do
  curl -s -o /dev/null "$AWS_ENDPOINT_URL" && break
  sleep 2
done

loadenv() { set -a; . "$ROOT/services/$1/.env"; set +a; }

echo "== 2/4 Inventory service (Lambda, API Gateway, S3 export bucket, secret)"
( loadenv inventory-service && bash "$ROOT/infra/floci/build-inventory-lambda.sh" && bash "$ROOT/infra/floci/setup-mohamed.sh" )

echo "== 3/4 Distribution + login service (Lambda + API Gateway)"
( cd "$ROOT/services/distribution-service" && bash infra/floci/setup-momen.sh )

echo "== 4/4 Alerts + reporting service (Lambda, API Gateway, S3, scheduler, CloudWatch)"
( cd "$ROOT/services/alerts-reporting-service" && npm install --silent && npm run floci:deploy )

echo
echo "All three setups finished. Copy each printed API URL into frontend/js/config.js (SERVICES)."
