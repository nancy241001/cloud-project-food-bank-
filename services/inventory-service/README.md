# inventory-service — Mohamed

Mohamed's own Express backend (port **3001** locally). Owns the `food_items` table
(see `database/schema/02_inventory.sql`).

**Build your endpoints to match `docs/API_CONTRACT.md` (Inventory section)**: `frontend/inventory.html`
already calls them. Your database login is `inventory_service` (`database/roles.sql`).

## What other backends need from this one (agreed contracts)

**Nancy's alerts-reporting-service calls:**

```
PATCH /api/items/{id}
Authorization: Bearer <the logged-in user's token, forwarded>
Content-Type: application/json

{ "quantity": 0 }
```

Used when staff resolve an expiry alert as *discarded* or *transferred*: the food has left the
building, so its stock must become 0. Please:
- accept `quantity: 0` from **staff and admin** roles,
- answer **200** on success, **404** if the item does not exist, **400** for an invalid quantity, **401/403** per your auth checks,
- verify the token with the **same `JWT_SECRET`** as the other backends,
- allow it server-to-server (no CORS needed: Nancy's backend calls it, not the browser).

Nancy's backend also **reads** `food_items` directly for reports (read-only database login,
see `database/roles.sql`). Please tell Nancy before renaming or removing columns.

## Local development

```powershell
copy .env.example .env
npm install
npm test
npm start
```

Set `DATABASE_URL`, the shared `JWT_SECRET`, and the frontend `CORS_ORIGIN` in `.env`.
The service listens on port `3001` by default. Tests use a seeded in-memory PostgreSQL
database and never connect to Neon.

## Floci integrations

Floci uses the same AWS SDK paths as AWS, selected by `AWS_ENDPOINT_URL`. Copy only
placeholder names from `.env.example`; keep connection strings and credentials in the
ignored `.env` or your shell.

```powershell
$env:AWS_ENDPOINT_URL = 'http://127.0.0.1:4566'
$env:AWS_REGION = 'us-east-1'
$env:AWS_ACCESS_KEY_ID = 'test'
$env:AWS_SECRET_ACCESS_KEY = 'test'
$env:USE_SECRETS_MANAGER = 'true'
$env:INVENTORY_SECRET_ID = 'foodbank/mohamed/inventory'
$env:INVENTORY_EXPORTS_BUCKET = 'foodbank-inventory-exports'
$env:CW_LOG_GROUP = '/foodbank/inventory'
npm start
```

- Startup reads `DATABASE_URL` from the JSON secret when `USE_SECRETS_MANAGER=true`.
- `POST /api/items/export` is admin-only and uploads current stock (`quantity > 0`)
  as a CSV to the private, encrypted Inventory exports bucket.
- A successful `POST /api/items` publishes `INVENTORY_DONATION_CREATED` with only
  `itemId`, `quantity`, and `actorId` to CloudWatch Logs.
- `node scripts/verify-floci.js` provisions/checks these resources using the ignored
  local `.env`, creates one test donation, verifies the CSV and audit event, and removes
  the test database row. It never displays secret values.

The shared database owner must have applied `database/roles.sql`. In particular,
`inventory_service` needs `SELECT (user_id, name, role) ON users` so list responses can
populate `created_by_name` without granting access to password hashes or email addresses.

### Lambda and API Gateway in Floci

The same Express app runs locally on port `3001` and in Lambda through
`src/lambda/apiHandler.js`. From the repository root:

```bash
bash infra/floci/build-inventory-lambda.sh
export DATABASE_URL='<inventory_service connection string>'
export JWT_SECRET='<shared JWT secret>'
bash infra/floci/setup-mohamed.sh
```

The setup script stores both values in `foodbank/mohamed/inventory`, deploys the
`mohamed-inventory-api` Lambda, and creates HTTP API Gateway routes for `/health` and
`/api/items`. It prints the local Floci API Gateway URL without printing either secret.
