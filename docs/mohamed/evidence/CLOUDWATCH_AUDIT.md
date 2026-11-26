# Floci CloudWatch audit evidence

Captured: 2026-11-26 from log group `/foodbank/inventory` after saving a synthetic donation.

```json
{"event":"INVENTORY_DONATION_CREATED","itemId":25,"quantity":1,"actorId":2}
```

The matching event was found and contains only the allowed audit fields. The synthetic Inventory
row was subsequently confirmed absent from `food_items` using the Inventory database identity.

During this earlier evidence run, API cleanup returned HTTP 500 because the Inventory identity did
not yet have the narrow history-check grant. The synthetic row was removed directly from the
Inventory-owned table. After granting read access to `distribution_items.item_id` only, the
Gateway deletion behavior was retested successfully; see `DELETE_GATEWAY.md`.
