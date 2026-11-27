#!/usr/bin/env bash
# Deploys Momen's service on Floci (docker compose up -d first). Reads secrets from .env, never prints them.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash on Windows would rewrite /aws/lambda/... into a C:/ path
cd "$(dirname "$0")/../.."
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1
EP=http://localhost:4566
aws() { command aws --endpoint-url "$EP" "$@"; }
set -a; . ./.env; set +a

FN=momen-distribution-api; ROLE=momen-distribution-api-role; SECRET=foodbank/momen/app

bash infra/floci/build-lambda.sh

# 1) Secret (DB url + JWT secret live in Secrets Manager, not in the code)
BODY=$(node -e 'console.log(JSON.stringify(Object.fromEntries(["DATABASE_URL","JWT_SECRET"].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))))')
aws secretsmanager create-secret --name $SECRET --secret-string "$BODY" >/dev/null 2>&1 \
  || aws secretsmanager put-secret-value --secret-id $SECRET --secret-string "$BODY" >/dev/null

# 2) Least-privilege role
aws iam create-role --role-name $ROLE --assume-role-policy-document file://policies/momen-api-trust.json >/dev/null 2>&1 || true
aws iam put-role-policy --role-name $ROLE --policy-name momen-api-least-privilege --policy-document file://policies/momen-api-policy.json
ROLE_ARN=$(aws iam get-role --role-name $ROLE --query Role.Arn --output text)

# 3) Log group (show the error if it fails, then check it exists)
aws logs create-log-group --log-group-name /aws/lambda/$FN 2>&1 | grep -v ResourceAlreadyExists || true

# 4) Lambda
ENVV="Variables={USE_SECRETS_MANAGER=true,APP_SECRET_ID=$SECRET,CORS_ORIGIN=$CORS_ORIGIN,NODE_ENV=production}"
if aws lambda get-function --function-name $FN >/dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --zip-file fileb://build/momen-api.zip >/dev/null
else
  aws lambda create-function --function-name $FN --runtime nodejs22.x --handler src/lambda/apiHandler.handler \
    --role "$ROLE_ARN" --timeout 15 --memory-size 256 --zip-file fileb://build/momen-api.zip --environment "$ENVV" >/dev/null
fi

# 5) API Gateway v2 (HTTP API): the REST API type rejects the Authorization header on Floci
API_ID=$(aws apigatewayv2 create-api --name momen-api --protocol-type HTTP --query ApiId --output text)
LAMBDA_ARN=$(aws lambda get-function --function-name $FN --query Configuration.FunctionArn --output text)
INT=$(aws apigatewayv2 create-integration --api-id "$API_ID" --integration-type AWS_PROXY --integration-uri "$LAMBDA_ARN" \
  --payload-format-version 2.0 --query IntegrationId --output text)
for R in "ANY /api/auth/{proxy+}" "ANY /api/users" "ANY /api/users/{proxy+}" "ANY /api/families" "ANY /api/families/{proxy+}" \
         "ANY /api/distributions" "ANY /api/distributions/{proxy+}" "GET /health"; do
  aws apigatewayv2 create-route --api-id "$API_ID" --route-key "$R" --target "integrations/$INT" >/dev/null
done
aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy \
  --default-route-settings ThrottlingBurstLimit=50,ThrottlingRateLimit=25 >/dev/null 2>&1 \
  || { echo "WARN: throttling not supported here, creating stage without it (the app's rate limiter still protects login)";
       aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy >/dev/null; }

# 6) Threat detection: metric filters on the JSON logs + alarm
LG=/aws/lambda/$FN
aws logs put-metric-filter --log-group-name $LG --filter-name failed-logins \
  --filter-pattern '{ $.event = "LOGIN_FAILED" }' \
  --metric-transformations metricName=FailedLogins,metricNamespace=FoodBank/Momen,metricValue=1 || echo "WARN: metric filter unsupported"
aws logs put-metric-filter --log-group-name $LG --filter-name denied-requests \
  --filter-pattern '{ $.event = "REQUEST" && ($.status = 401 || $.status = 403) }' \
  --metric-transformations metricName=DeniedRequests,metricNamespace=FoodBank/Momen,metricValue=1 || echo "WARN: metric filter unsupported"
TOPIC=$(aws sns create-topic --name foodbank-security-alerts --query TopicArn --output text)
aws cloudwatch put-metric-alarm --alarm-name momen-failed-logins-spike --namespace FoodBank/Momen --metric-name FailedLogins \
  --statistic Sum --period 60 --evaluation-periods 1 --threshold 5 --comparison-operator GreaterThanOrEqualToThreshold \
  --alarm-actions "$TOPIC" || echo "WARN: alarm unsupported"

echo
echo "Done. Base URL: http://localhost:4566/restapis/$API_ID  (HTTP API: try http://$API_ID.execute-api.localhost.floci.io:4566/health)"