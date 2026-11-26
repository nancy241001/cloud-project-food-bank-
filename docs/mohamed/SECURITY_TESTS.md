# Inventory security tests: expected versus actual

Automated results are produced by `npm test` in `services/inventory-service`. Manual rows must
remain pending until tested against the relevant deployed environment. Never paste authorization
headers, environment files, connection strings, or database error details into report evidence.

| ID | Scenario | Expected | Actual | Result | Evidence source |
|---|---|---|---|---|---|
| INV-ST-01 | Call each Inventory method with no authentication | 401; no database or S3 call | 401 for list, create, patch, delete, and export; dependencies untouched | Pass | `tests/security.test.js` |
| INV-ST-02 | Staff attempts delete | 403; database unchanged | 403 locally and through deployed Gateway; synthetic item remained until admin action | Pass | `tests/security.test.js`, `docs/mohamed/evidence/DELETE_GATEWAY.md` |
| INV-ST-03 | Staff attempts stock export | 403; S3 exporter not called | 403; database and exporter not called | Pass | `tests/security.test.js` |
| INV-ST-04 | Send malformed JSON | 400; no stack trace; no database call | 400 with generic JSON error; no database call | Pass | `tests/security.test.js` |
| INV-ST-05 | Submit unsupported ownership field | 400 before SQL | 400; database not called | Pass | `tests/security.test.js` |
| INV-ST-06 | Injection-shaped category and item ID | 400 before SQL | 400; database not called | Pass | `tests/security.test.js` |
| INV-ST-07 | Injection-shaped free-text search | Input remains a bound value | SQL text excludes input; placeholder parameter contains it | Pass | `tests/security.test.js` |
| INV-ST-08 | Staff and admin set quantity to zero | 200 for both permitted roles | 200 for both | Pass | `tests/items.test.js` |
| INV-ST-09 | Delete item with distribution history | 409; history preserved | 409 locally and through deployed Gateway; history-backed item retained | Pass | `tests/items.test.js`, `docs/mohamed/evidence/DELETE_GATEWAY.md` |
| INV-ST-10 | Checked-in database permissions | Own-table CRUD; only required cross-service columns readable | Grant contract matches; `food_items` and history-check column reads succeed in Neon; no distribution write privilege | Pass | `tests/security.test.js`, `database/roles.sql`, `docs/mohamed/evidence/NEON_LEAST_PRIVILEGE.md` |
| INV-ST-11 | Inventory database identity reads a sensitive authentication column | Permission denied | Denied with SQLSTATE `42501` | Pass | `docs/mohamed/evidence/NEON_LEAST_PRIVILEGE.md` |
| INV-ST-12 | Inventory database identity writes another service's table | Permission denied | Denied with SQLSTATE `42501` | Pass | `docs/mohamed/evidence/NEON_LEAST_PRIVILEGE.md` |
| INV-ST-13 | Open S3 export without authorization | Access denied | Not rerun for this test set | Pending manual Floci check | Sanitized HTTP response screenshot |
| INV-ST-14 | API Gateway health request | 200 with Inventory health body | 200; service `inventory-service`; status `ok` | Pass | `docs/mohamed/evidence/FLOCI_GATEWAY.md` |
| INV-ST-15 | Authenticated in-stock Inventory read | 200 with item array | 200; item count `20` | Pass | `docs/mohamed/evidence/FLOCI_GATEWAY.md` |
| INV-ST-16 | Staff and admin request current-stock export | Staff 403; admin 201; private encrypted object created | Staff 403; admin 201; 20 items; S3 object uses AES256 | Pass | `docs/mohamed/evidence/EXPORT_AUTHORIZATION.md`, `docs/mohamed/evidence/S3_EXPORT.md` |
| INV-ST-17 | Successful donation emits minimal audit event | Event contains item ID, quantity, and actor ID only | Matching event found for synthetic item 25 | Pass | `docs/mohamed/evidence/CLOUDWATCH_AUDIT.md` |
| INV-ST-18 | Admin deletes an unreferenced item through deployed API | 204 and item removed | 204; synthetic item absence confirmed in the database | Pass | `docs/mohamed/evidence/DELETE_GATEWAY.md` |

The static grant contract and runtime Neon checks now agree. INV-ST-13 remains pending because an
unsigned/public S3 request was not performed in this evidence run. The prior delete integration
failure was resolved using only column-level `SELECT` on `distribution_items.item_id`; broad read
and all write access remain absent.
