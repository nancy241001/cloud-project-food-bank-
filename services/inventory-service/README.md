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
