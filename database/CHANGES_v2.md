# Database v2: what changed from v1 and why
Schema v2.1 adds per-tab authentication sessions so multiple users can be signed in independently in separate browser tabs. Schema v2.2 adds buyer payment tracking for owner-recorded farm sales. Run the sequential upgrades in `WINDOWS_SETUP.md`.

| Review point | Result |
|---|---|
| First owner account | Created on a first-run web page (disabled afterwards). `seed-demo` is now development-only. |
| Stock in transit | `v_stock_in_transit` view, "On the way to shop" on the dashboard, "+X L on the way" on the shop screens. The farm-to-shop ledger stays two-sided (farm out at dispatch, shop in at receipt); in-transit is derived, so it cannot drift. |
| Business data isolation | Composite foreign keys `(id, business_id)` on every link between records; item tables now carry `business_id`. The database refuses a record that points at another business's farm/shop/product/dispatch. |
| Account management | Users screen (add, deactivate, reset, unlock), change own password, temporary passwords that must be changed, 5-failure lockout for 15 minutes. |
| Password-reset tokens | Not built: they need email/SMS. The owner issues a temporary password instead. Add tokens when email/SMS notifications are added. |
| Initial stock | `opening_balances` table + Opening stock screen (feeds the stock ledger and the first daily closing). |
| External sales in revenue | Dashboard "Total revenue" = shop sales + external sales (still shown separately too). |
| User activity | Every operation records who did it; owner "Activity" screen reads the append-only audit log. |
| Closings / adjustments | Already built (noon deadline, in-order closing, owner-approved adjustments). |
| Backups | `flask backup` command + restore steps. |
| Dispatch/receipt item uniqueness | `UNIQUE (dispatch_id, product_id)` and `UNIQUE (receipt_id, product_id)`. |
| Tab-scoped authentication | `auth_sessions` stores hashed, expiring per-tab session tokens; see the v2.1 migration. |
| Buyer farm sales | External farm sales store PAID/UNPAID status; unpaid sales can be marked paid later. |
| Tests | Backend tests are run on SQLite by default and can also run on real MySQL. |
