# Food Bank Inventory — Group 36

Track donated food with quantities and expiry dates by category, record distributions to families,
and alert staff about items expiring soon.

**One shared frontend, three separate backends (one per student), one Neon database.**

| Backend | Owner | Folder | Local port | Owns tables |
|---|---|---|---|---|
| inventory-service | Mohamed | `services/inventory-service` | 3001 | `food_items` |
| distribution-service (+ auth) | Momen | `services/distribution-service` | 3002 | `users`, `families`, `distributions`, `distribution_items` |
| **alerts-reporting-service** | **Nancy** | `services/alerts-reporting-service` | **3003** | `alert_settings`, `expiry_alerts`, `saved_reports` |

```
frontend/            shared HTML/CSS/JS; js/config.js says which backend serves which URL
database/            Neon setup for ALL services: schema/01-04 (one file per owner), setup/seed/status scripts, roles.sql
services/<name>/     each student's own Express backend: own package.json, .env, tests, deploy
infra/floci/         AWS resources on Floci (Nancy's: setup-nancy.sh)
docs/                guides and report material
```

How the backends work together:
- **Login**: Momen's service issues a JWT; every backend verifies it with the same `JWT_SECRET`.
- **Data**: each backend writes only its own tables; others may read through a read-only DB login.
- **Changes to another service's data go through its API** (e.g. Nancy → `PATCH /api/items/{id}` on Mohamed's).

## Get started
1. **Database (Neon):** follow `database/README.md` (creates all tables, demo data, one login per service).
2. **Frontend:** static files. From the project folder: `npx serve frontend -l 3000`, then open http://localhost:3000.
   Each backend's URL is set in `frontend/js/config.js`; the pages and the endpoints they call are listed in `docs/API_CONTRACT.md`.
3. **Backends:** each student runs their own (`services/<name>`). Nancy's: `services/alerts-reporting-service/README.md`.

| Page | Owner | Backend it calls |
|---|---|---|
| `login.html`, `users.html` (admin) | Momen | distribution-service `/api/auth`, `/api/users` |
| `inventory.html` | Mohamed | inventory-service `/api/items` |
| `distribution.html` | Momen | distribution-service `/api/families`, `/api/distributions` (+ reads `/api/items`) |
| `alerts.html`, `reports.html`, `index.html` (dashboard), nav badge | Nancy | alerts-reporting-service `/api/alerts`, `/api/reports` |
