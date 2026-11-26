# Inventory Gateway deletion evidence

Captured: 2026-11-26 through the Inventory API Gateway deployment after applying the narrow
Neon history-check grant.

| Check | Sanitized actual result | Result |
|---|---|---|
| Gateway health | HTTP 200 | Pass |
| Create synthetic unreferenced Inventory item | HTTP 201 | Pass |
| Staff deletes the synthetic item | HTTP 403 | Pass |
| Admin deletes the synthetic item | HTTP 204; database absence confirmed | Pass |
| Admin deletes an existing history-backed item | HTTP 409; database retention confirmed | Pass |

Only the newly created synthetic item was eligible for deletion. The history-backed item was not
modified. No token, authorization header, donor detail, database location, credential, or
connection string was retained.
