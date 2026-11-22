# alerts-reporting-service — Nancy

Expiry Alerts & Reporting, as its own backend. Port **3003** locally; deployed as its own
Lambda behind its own API Gateway on Floci.

## Run it

1. Create the database first: `database/README.md` (Neon, all tables, demo data, the `alerts_service` login).
2. Configure and start:
```powershell
cd services\alerts-reporting-service
npm install
copy .env.example .env      # DATABASE_URL = the alerts_service login, JWT_SECRET = same as Momen's service
npm start                   # http://localhost:3003/health
```
Do not run `npm run migrate` on Neon: the tables are created once by `database/` setup, and the
`alerts_service` login is deliberately not allowed to create tables.

3. Test the API before Momen's login exists (Postman / `docs/nancy/requests.http`):
```powershell
npm run token -- 2 staff     # prints a token for Staff One (user 2 after the database seed)
npm run token -- 1 admin
```
This only signs a token with your own `JWT_SECRET`, the same way Momen's login will. It is a test tool
and refuses to run in production.

4. Automated tests (91): they wipe the database they use, so use a **Neon test branch**, never the main one:
```powershell
$env:TEST_DATABASE_URL = "<test branch connection string>"; npm test
```

## Deploy on Floci
See `infra/floci/setup-nancy.sh` and `docs/nancy/GUIDE.md` section 11.
