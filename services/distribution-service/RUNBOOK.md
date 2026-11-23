# distribution-service (login + users + families + distributions) — port 3002

## Run locally
1. `copy .env.example .env` and fill DATABASE_URL (distribution_service login) and JWT_SECRET (the shared one).
2. `npm.cmd install`
3. `npm.cmd test`     (no database needed, the pool is mocked)
4. `npm.cmd start`    -> http://localhost:3002/health

## Run on Floci (local AWS)
1. Start Docker Desktop, then `docker compose up -d`
2. `bash infra/floci/setup-momen.sh`   (needs the AWS CLI and a filled .env)
Floci forgets everything on restart: run the script again.
