#!/usr/bin/env bash
# Inventory service resources in local Floci. Values come from the caller's shell;
# this file intentionally contains placeholders/default resource names only.
set -euo pipefail
cd "$(dirname "$0")"

export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://127.0.0.1:4566}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
# Prevent Git Bash on Windows from rewriting /log/groups and AWS resource paths.
export MSYS_NO_PATHCONV=1

BUCKET="${INVENTORY_EXPORTS_BUCKET:-foodbank-inventory-exports}"
SECRET_ID="${INVENTORY_SECRET_ID:-foodbank/mohamed/inventory}"
LOG_GROUP="${CW_LOG_GROUP:-/foodbank/inventory}"
API_FN="mohamed-inventory-api"
API_NAME="mohamed-inventory-api"
ROLE="mohamed-inventory-api-role"
ZIP="inventory-service.zip"
ACCOUNT=000000000000
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:3000}"

: "${DATABASE_URL:?export the inventory_service DATABASE_URL first}"
: "${JWT_SECRET:?export the shared JWT_SECRET first}"

aws s3api create-bucket --bucket "$BUCKET" >/dev/null 2>&1 || true
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

SECRET_JSON=$(node -e 'process.stdout.write(JSON.stringify({DATABASE_URL:process.env.DATABASE_URL,JWT_SECRET:process.env.JWT_SECRET}))')
if aws secretsmanager describe-secret --secret-id "$SECRET_ID" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --secret-string "$SECRET_JSON" >/dev/null
else
  aws secretsmanager create-secret --name "$SECRET_ID" --secret-string "$SECRET_JSON" >/dev/null
fi
unset SECRET_JSON

ensure_log_group() {
  local group="$1"
  aws logs create-log-group --log-group-name "$group" >/dev/null 2>&1 || true
  for _ in {1..10}; do
    if aws logs put-retention-policy --log-group-name "$group" --retention-in-days 14 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "failed to configure log group $group" >&2
  return 1
}
ensure_log_group "$LOG_GROUP"
ensure_log_group "/aws/lambda/$API_FN"

# Lambda role: only Inventory's secret, export prefix, and logs.
aws iam create-role --role-name "$ROLE" --assume-role-policy-document file://policies/lambda-trust.json >/dev/null 2>&1 || true
aws iam put-role-policy --role-name "$ROLE" --policy-name inventory-api-least-privilege \
  --policy-document file://policies/inventory-api-policy.json

# Deploy/update the same Express app used by npm start.
[ -f "$ZIP" ] || { echo "run build-inventory-lambda.sh first"; exit 1; }
LAMBDA_ENV="Variables={USE_SECRETS_MANAGER=true,INVENTORY_SECRET_ID=$SECRET_ID,INVENTORY_EXPORTS_BUCKET=$BUCKET,CW_LOG_GROUP=$LOG_GROUP,CORS_ORIGIN=$FRONTEND_ORIGIN,NODE_ENV=production}"
if aws lambda get-function --function-name "$API_FN" >/dev/null 2>&1; then
  LOCAL_SHA=$(openssl dgst -sha256 -binary "$ZIP" | base64 | tr -d '\r\n')
  REMOTE_SHA=$(aws lambda get-function-configuration --function-name "$API_FN" --query CodeSha256 --output text)
  if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    # Floci 2.4 can apply an update but leave this HTTP response open. Confirm the
    # deployed hash instead of treating a client timeout as either success or failure.
    aws --cli-read-timeout 30 lambda update-function-code --function-name "$API_FN" --zip-file "fileb://$ZIP" >/dev/null 2>&1 || true
    UPDATED=false
    for _ in {1..60}; do
      REMOTE_SHA=$(aws lambda get-function-configuration --function-name "$API_FN" --query CodeSha256 --output text 2>/dev/null || true)
      if [ "$REMOTE_SHA" = "$LOCAL_SHA" ]; then UPDATED=true; break; fi
      sleep 1
    done
    [ "$UPDATED" = true ] || { echo "Lambda code update could not be verified" >&2; exit 1; }
  fi
  ENV_QUERY='join(`|`, [Environment.Variables.USE_SECRETS_MANAGER, Environment.Variables.INVENTORY_SECRET_ID, Environment.Variables.INVENTORY_EXPORTS_BUCKET, Environment.Variables.CW_LOG_GROUP, Environment.Variables.CORS_ORIGIN, Environment.Variables.NODE_ENV])'
  EXPECTED_ENV="true|$SECRET_ID|$BUCKET|$LOG_GROUP|$FRONTEND_ORIGIN|production"
  CURRENT_ENV=$(aws lambda get-function-configuration --function-name "$API_FN" --query "$ENV_QUERY" --output text)
  if [ "$CURRENT_ENV" != "$EXPECTED_ENV" ]; then
    aws --cli-read-timeout 30 lambda update-function-configuration --function-name "$API_FN" --environment "$LAMBDA_ENV" >/dev/null 2>&1 || true
    CONFIGURED=false
    for _ in {1..60}; do
      CURRENT_ENV=$(aws lambda get-function-configuration --function-name "$API_FN" --query "$ENV_QUERY" --output text 2>/dev/null || true)
      if [ "$CURRENT_ENV" = "$EXPECTED_ENV" ]; then CONFIGURED=true; break; fi
      sleep 1
    done
    [ "$CONFIGURED" = true ] || { echo "Lambda environment update could not be verified" >&2; exit 1; }
  fi
else
  aws lambda create-function --function-name "$API_FN" --runtime nodejs22.x \
    --handler src/lambda/apiHandler.handler --zip-file "fileb://$ZIP" \
    --role "arn:aws:iam::${ACCOUNT}:role/$ROLE" --timeout 30 --memory-size 256 \
    --environment "$LAMBDA_ENV" >/dev/null
fi

# HTTP API Gateway routes only Inventory-owned paths and health to this Lambda.
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)
if [ "$API_ID" = "None" ] || [ -z "$API_ID" ]; then
  API_ID=$(aws apigatewayv2 create-api --name "$API_NAME" --protocol-type HTTP --query ApiId --output text)
fi
INTEG=$(aws apigatewayv2 get-integrations --api-id "$API_ID" \
  --query "Items[?IntegrationUri=='arn:aws:lambda:${AWS_DEFAULT_REGION}:${ACCOUNT}:function:${API_FN}'].IntegrationId | [0]" --output text)
if [ "$INTEG" = "None" ] || [ -z "$INTEG" ]; then
  INTEG=$(aws apigatewayv2 create-integration --api-id "$API_ID" --integration-type AWS_PROXY \
    --payload-format-version 2.0 --integration-uri "arn:aws:lambda:${AWS_DEFAULT_REGION}:${ACCOUNT}:function:${API_FN}" \
    --query IntegrationId --output text)
fi
for ROUTE in "ANY /api/items" "ANY /api/items/{proxy+}" "GET /health" "OPTIONS /{proxy+}"; do
  EXISTING=$(aws apigatewayv2 get-routes --api-id "$API_ID" --query "Items[?RouteKey=='$ROUTE'].RouteId | [0]" --output text)
  if [ "$EXISTING" = "None" ] || [ -z "$EXISTING" ]; then
    aws apigatewayv2 create-route --api-id "$API_ID" --route-key "$ROUTE" --target "integrations/$INTEG" >/dev/null
  fi
done
STAGE=$(aws apigatewayv2 get-stages --api-id "$API_ID" --query 'Items[?StageName==`$default`].StageName | [0]' --output text)
if [ "$STAGE" = "None" ] || [ -z "$STAGE" ]; then
  aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy >/dev/null
fi
aws lambda add-permission --function-name "$API_FN" --statement-id apigw-invoke \
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${AWS_DEFAULT_REGION}:${ACCOUNT}:${API_ID}/*" >/dev/null 2>&1 || true

API_URL="http://${API_ID}.execute-api.localhost.floci.io:4566"
echo "Inventory Floci resources are ready (no secret values displayed)."
echo "Inventory API: $API_URL"
