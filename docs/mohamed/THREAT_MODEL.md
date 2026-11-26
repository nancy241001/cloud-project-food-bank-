# Inventory service threat model

Scope: `services/inventory-service`, its `food_items` data, and its Inventory-specific
Floci/Vercel deployment. Authentication is issued by the shared identity service and verified
by Inventory with HS256 only.

| ID | Threat | Impact | Implemented control | Evidence |
|---|---|---|---|---|
| INV-T1 | Missing, expired, or forged authentication | Unauthorized inventory disclosure or modification | Every `/api/items` route uses authentication middleware; verification allows HS256 only | Automated security tests: 401 before database access |
| INV-T2 | Staff invokes an admin operation | Unauthorized deletion or export | Backend role checks protect delete and export; frontend visibility is not trusted | Automated security tests: staff receives 403 and no dependency is called |
| INV-T3 | SQL injection through search, filters, or IDs | Data disclosure or corruption | Strict category/date/ID validation and PostgreSQL placeholders for request values | Automated rejection tests and parameterization assertion |
| INV-T4 | Mass assignment or malformed JSON | Unauthorized ownership changes, crashes, or leaked stack traces | Allowed-field lists, type/range validation, limited JSON parser, centralized errors | Automated 400 tests; database remains untouched |
| INV-T5 | Deleting an item used by distribution history | Broken audit history | Delete checks `distribution_items.item_id`; conflict returns 409 and recommends quantity zero | Functional test and deployed Gateway 409 with retention verification |
| INV-T6 | Compromised Inventory database identity | Access to authentication data or other services' writes | `inventory_service` owns `food_items`; cross-service reads are column-level for required user display fields and `distribution_items.item_id`; no distribution writes | Static grant-contract test and runtime Neon privilege evidence |
| INV-T7 | Secret disclosure in source, logs, or screenshots | Database and account compromise | Ignored `.env`; placeholder-only `.env.example`; Secrets Manager; audit events contain identifiers and quantity only | Repository review plus sanitized evidence checklist |
| INV-T8 | Public or tampered inventory exports | Stock-data exposure | Admin-only export, private S3 bucket, Block Public Access, AES-256 storage encryption | Floci configuration and sanitized bucket screenshots |
| INV-T9 | Unsafe stock values or expired donations | Incorrect operational decisions | Integer and date validation; creation requires positive stock and non-expired food; patch permits zero for disposal/transfer | Existing functional tests |
| INV-T10 | Floating emulator image or inconsistent deployment | Unavailable API or unrepeatable evidence | Floci pinned to 2.4.0; Lambda ZIP and deployed configuration verified by hash | Compose diff, deployment output, API Gateway health check |

Residual risks:

- HS256 depends on protecting one shared signing value across services; rotation requires coordinated restart/redeployment.
- The history check creates a narrow cross-service dependency on `distribution_items.item_id`; schema or ownership changes require coordinated testing with the Distribution service.
- Floci is development evidence, not a substitute for production AWS security assessment.
- Vercel and Lambda concurrency can increase database connections; the pool remains deliberately small.
