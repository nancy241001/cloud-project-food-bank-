# distribution-service — Momen

Momen's own Express backend (port **3002** locally), plus **authentication** (Momen leads auth).
Owns `users`, `families`, `distributions`, `distribution_items` (see `database/schema/01_users.sql`, `03_distribution.sql`).

**Build your endpoints to match `docs/API_CONTRACT.md`** (auth, users, families, distributions):
`frontend/login.html`, `users.html` and `distribution.html` already call them. Your database login is
`distribution_service` (`database/roles.sql`); it may update only `food_items.quantity` so stock is
checked and reduced in the same transaction as the distribution.

## What other backends need from this one (agreed contracts)

**Login (used by the shared frontend):**
```
POST /api/auth/login   { "email": "...", "password": "..." }
200 -> { "token": "<JWT>", "user": { "id": 1, "name": "...", "role": "staff" | "admin" } }
401 -> wrong email/password
```
The JWT must be **HS256**, signed with the shared `JWT_SECRET`, and contain
`sub` (user id as text), `role` and `name`, with an expiry (e.g. 2 hours).
Every backend verifies tokens itself with the same secret.

**Nancy's alerts-reporting-service reads (read-only DB login):**
- `distributions`, `distribution_items`, `families.household_ref` for the distribution report,
- `users (user_id, name, role)` to show who handled an alert.

When a distribution brings an item's quantity to 0, Nancy's next expiry scan closes its alert
automatically, so **keep reducing `food_items.quantity` when food is distributed**.

## Deploy on Vercel (public demo)

Create a Vercel project with **Root Directory** `services/distribution-service`, then set these environment
variables in the Vercel dashboard (never in the repo): `DATABASE_URL` (distribution_service login),
`JWT_SECRET` (the shared one, 32+ characters) and `CORS_ORIGIN` (the frontend URL). `vercel.json` sends every
request to `api/index.js`, which runs the same Express app as the Floci Lambda. Secrets Manager and
CloudWatch metrics only work in the Floci/AWS deployment, not on Vercel.
