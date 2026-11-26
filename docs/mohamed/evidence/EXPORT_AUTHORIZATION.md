# Inventory export authorization evidence

Captured: 2026-11-26 through the Inventory API Gateway deployment.

| Actor and request | Sanitized actual result | Result |
|---|---|---|
| Staff, `POST /api/items/export` | HTTP 403; export dependency not authorized | Pass |
| Admin, `POST /api/items/export` | HTTP 201; exported item count `20` | Pass |

No authorization header, token, account password, or signed URL was captured.
