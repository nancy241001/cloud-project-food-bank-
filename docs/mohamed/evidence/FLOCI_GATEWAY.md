# Floci API Gateway evidence

Captured: 2026-11-26 against the Inventory API deployed to Floci 2.4.0.

| Request | Sanitized actual result | Result |
|---|---|---|
| `GET /health` through API Gateway | HTTP 200; service `inventory-service`; status `ok` | Pass |
| Authenticated `GET /api/items?in_stock=true` | HTTP 200; item count `20` | Pass |

The API identifier was `9183acd909`. Authorization headers, tokens, database details, and the
Gateway host were not retained in this evidence.
