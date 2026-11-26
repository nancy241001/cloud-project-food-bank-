# Neon least-privilege evidence

Captured: 2026-11-26 using the `inventory_service` database identity.

| Check | Sanitized actual result | Result |
|---|---|---|
| Read one row boundary from `food_items` | Query permitted; no row data retained | Pass |
| Read `distribution_items.item_id` for deletion history | Column-level query permitted | Pass |
| Write to `distribution_items` | No table write privilege | Pass |
| Read `users.password_hash` | Denied with PostgreSQL SQLSTATE `42501` | Pass |
| Write to `families` | Denied with PostgreSQL SQLSTATE `42501` | Pass |

The check loaded the ignored local environment at runtime. No hostname, username, password,
connection string, query result data, or environment-file content was captured.

The only cross-service grant added for the delete history check is:

```sql
GRANT SELECT (item_id) ON TABLE public.distribution_items TO inventory_service;
```

It does not grant table-wide read, sequence access, or any insert, update, or delete privilege.
