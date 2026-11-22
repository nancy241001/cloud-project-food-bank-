# API contract — what the shared frontend expects from each backend

The frontend (`frontend/`) is built against this contract. **Mohamed and Momen: build your backend to
match it**, or tell the team and update the page if you change something.

Rules for every endpoint:
- JSON in, JSON out. Errors are `{ "error": "human readable message" }` (the page shows this text).
- `Authorization: Bearer <JWT>` on every request except login. Verify with the shared `JWT_SECRET`, HS256 only.
- **401** = missing/invalid/expired token (the page sends the user to login).
  **403** = logged in but the role is not allowed. Enforce roles **in the backend**; the page only hides buttons.
- Validate everything on the server. **400** for bad input, **404** not found, **409** business-rule conflict.
- Dates are `YYYY-MM-DD` strings; timestamps are ISO strings.
- CORS: allow the frontend origin, methods GET/POST/PUT/PATCH/DELETE, headers Content-Type and Authorization.
- Categories: `dairy, bakery, fresh, dry, canned, frozen, beverages, hygiene, other`.

---

## Momen — authentication and users (`/api/auth`, `/api/users`)

### `POST /api/auth/login` (public)
Request `{ "email": "staff1@foodbank.local", "password": "..." }`
- 200 `{ "token": "<JWT>", "user": { "id": 2, "name": "Staff One", "role": "staff" } }`
- 400 missing fields · 401 wrong email/password **or deactivated user** (same message, so attackers can't tell which)

JWT claims: `sub` (user id as text), `role` (`staff`|`admin`), `name`, `exp` (≈2 hours).

### `GET /api/users` — admin
200 `{ "count": 3, "users": [ { "user_id", "name", "email", "role", "is_active", "created_at" } ] }` (never the hash)

### `POST /api/users` — admin
Request `{ "name", "email", "password" (10+ chars), "role": "staff"|"admin" }`
- 201 the new user (no hash) · 400 invalid · 409 email already used

### `PATCH /api/users/:id` — admin
Request any of `{ "role": "staff"|"admin", "is_active": true|false }`
- 200 updated user · 400 · 404 · **409 if an admin tries to demote or deactivate themselves** (so the last admin can't lock everyone out)

---

## Mohamed — inventory (`/api/items`)

Item object used everywhere:
```json
{ "item_id": 7, "name": "Canned beans", "category": "canned", "quantity": 150, "unit": "can",
  "donation_date": "2026-11-01", "expiry_date": "2026-11-28", "days_left": 6,
  "donor_type": "shop", "donor_name": "Hyper One", "lot": "B12", "storage_location": "Shelf 5",
  "created_by_name": "Staff One" }
```
`donor_type`: `individual | shop | organization`. `days_left` = expiry_date − today (negative = expired).

### `GET /api/items` — staff, admin
Query (all optional): `q` (name contains, case-insensitive), `category`, `expiring_before` (date),
`in_stock=true` (quantity > 0), `low_stock=true` (quantity ≤ 10).
Order: `expiry_date` ascending (first-expiry-first-out).
- 200 `{ "count": 19, "items": [ item, ... ] }` · 400 invalid filter

### `POST /api/items` — staff, admin (record a donation)
Request `{ "name", "category", "quantity" (int ≥ 1), "unit", "donation_date"? (default today), "expiry_date",
"donor_type", "donor_name"?, "lot"?, "storage_location"? }`
- 201 the item · 400 invalid, **or `expiry_date` already passed**, or `expiry_date` before `donation_date`

### `PATCH /api/items/:id` — staff, admin (update stock/details)
Request any of `{ "quantity" (int ≥ 0), "expiry_date", "storage_location", "lot", "name" }`
- 200 the item · 400 · 404
- **Also used by Nancy's backend** with `{ "quantity": 0 }` (user's token forwarded) when food is discarded/transferred.

### `DELETE /api/items/:id` — **admin only**
- 204 · 404 · **409 if the item appears in any distribution** (history must stay intact — set quantity 0 instead)

---

## Momen — families and distributions (`/api/families`, `/api/distributions`)

### `GET /api/families` — staff, admin
Query: `q` (household_ref contains), `status` (`active`|`inactive`)
- 200 `{ "count", "families": [ { "family_id", "household_ref", "household_size", "contact_phone", "status", "created_at", "last_distribution_at" } ] }`

### `POST /api/families` — staff, admin
Request `{ "household_ref" (e.g. FAM-0007), "household_size" (1–30), "contact_phone"? }`
- 201 the family · 400 · 409 household_ref already exists

### `PATCH /api/families/:id` — staff, admin
Request any of `{ "household_size", "contact_phone", "status": "active"|"inactive" }`
- 200 · 400 · 404

### `GET /api/distributions` — staff, admin
Query: `family_id`, `from`, `to` (dates)
- 200 `{ "count", "distributions": [ { "distribution_id", "distributed_at", "family_id", "household_ref",
  "staff_name", "notes", "items": [ { "item_id", "name", "category", "quantity", "unit" } ] } ] }` newest first

### `POST /api/distributions` — staff, admin (give food to a family)
Request `{ "family_id", "notes"?, "items": [ { "item_id", "quantity" (int ≥ 1) }, ... ] }` (1–20 lines, no duplicate items)
Business rules, **all in one database transaction** (all lines succeed or none do):
- family must exist (404) and be **active** (409)
- each item must exist (404), **not be expired** (409) and have **enough stock** (409, message names the item)
- stock is reduced for every line (lock the item rows with `SELECT ... FOR UPDATE`)
- `staff_user_id` comes from the token, never from the request
- 201 the created distribution (same shape as in GET)

---

## Nancy — alerts and reports
Already implemented: see `docs/nancy/REPORT_SECTIONS.md` section A.
