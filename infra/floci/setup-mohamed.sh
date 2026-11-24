#!/usr/bin/env bash
# Inventory service resources in local Floci. Values come from the caller's shell;
# this file intentionally contains placeholders/default resource names only.
set -euo pipefail

export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://127.0.0.1:4566}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"

BUCKET="${INVENTORY_EXPORTS_BUCKET:-foodbank-inventory-exports}"
SECRET_ID="${INVENTORY_SECRET_ID:-foodbank/mohamed/inventory}"
LOG_GROUP="${CW_LOG_GROUP:-/foodbank/inventory}"

: "${DATABASE_URL:?export the inventory_service DATABASE_URL first}"

aws s3api create-bucket --bucket "$BUCKET" >/dev/null 2>&1 || true
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

SECRET_JSON=$(node -e 'process.stdout.write(JSON.stringify({DATABASE_URL:process.env.DATABASE_URL}))')
if aws secretsmanager describe-secret --secret-id "$SECRET_ID" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --secret-string "$SECRET_JSON" >/dev/null
else
  aws secretsmanager create-secret --name "$SECRET_ID" --secret-string "$SECRET_JSON" >/dev/null
fi
unset SECRET_JSON

aws logs create-log-group --log-group-name "$LOG_GROUP" >/dev/null 2>&1 || true
aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 14
echo "Inventory Floci resources are ready (no secret values displayed)."
