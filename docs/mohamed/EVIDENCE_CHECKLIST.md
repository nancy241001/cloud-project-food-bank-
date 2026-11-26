# Inventory sanitized evidence checklist

Use this checklist before adding screenshots or terminal output to the report.

## Automated test evidence

- [x] Capture the final Jest summary showing suite and test counts.
- [x] Include only test names, statuses, and totals.
- [ ] Crop out shell history, environment output, and unrelated directories.
- [x] Confirm no authorization header or signed credential is visible.

## API evidence

- [ ] Show the request method and Inventory path.
- [x] Show only the response status and sanitized JSON body.
- [x] Remove request authentication headers before capture.
- [ ] Use synthetic item names and omit donor details where they are not required.
- [x] Include automated evidence for 401 and malformed-input 400, plus deployed staff 403 and authorized read evidence.

## Database least-privilege evidence

- [x] Use the `inventory_service` identity, not an owner identity.
- [x] Show successful access to `food_items` without displaying donor records.
- [x] Show permission denial for a sensitive authentication column.
- [x] Show permission denial for a write to another service's table.
- [ ] Crop connection dialogs, hostnames, role credentials, and connection strings.
- [ ] Do not include raw database errors if they echo connection parameters.

## Floci and deployment evidence

- [ ] Show Floci 2.4.0 healthy and the Inventory Lambda/API Gateway resource names.
- [ ] Show the private export bucket settings: all public access blocked and AES-256 encryption.
- [x] Show the donation audit event with only event name, item ID, quantity, and actor ID.
- [ ] Show Secrets Manager name only; never open or reveal the secret value.
- [x] Show API Gateway health status without headers or environment variables.

## Repository hygiene

- [x] Confirm the ignored environment file is not tracked.
- [x] Confirm deployment ZIP files are ignored.
- [x] Scan the proposed diff for connection strings, private keys, signed credentials, and passwords.
- [x] Confirm evidence contains no terminal command that expands a secret-bearing variable.
