# HarnKhong Admin

The `/admin` route is a separate, Supabase-authenticated dashboard. Its data access goes through `supabase/functions/admin-api`; the browser never receives a service-role key.

## Access rules

- The initial allowlisted address is `harnkhong@gmail.com`.
- A confirmed Supabase Auth account is required. On the first permitted login, the function assigns `app_metadata.role = "admin"` using the Auth Admin API.
- Every protected API action checks both the configured email allowlist and the current server-side `app_metadata.role`.
- To add administrators later, set the Edge Function secret `ADMIN_EMAILS` to a comma-separated list of additional addresses. The initial address remains allowed. Each new account must confirm its email and sign in once to receive its role.
- Set `ADMIN_ALLOWED_ORIGINS` to the deployed HarnKhong origins (comma-separated) to restrict browser origins. If unset, CORS uses `*`; requests still require a valid user JWT and server-side admin checks.
- Passwords remain in Supabase Auth; do not add them to this repository or browser configuration.

## Deployment order

1. Reconcile the already-reported remote migration-history drift before applying any migrations. Do not use a full `db push` against the current remote state until that review is complete.
2. Apply the new `admin_payment_verifications` migration after the migration history is reconciled. It stores the verified order total, verifier, and timestamp; the database function checks the amount against the locked order total and changes the payment status atomically.
3. Configure `ADMIN_EMAILS` and `ADMIN_ALLOWED_ORIGINS` as Edge Function secrets.
4. Deploy `admin-api` with JWT verification enabled (`verify_jwt = true`).
5. Confirm the first administrator account has a verified email, then sign in at `/admin`.

The initial Payments view covers the existing `secondhand_orders` table. The remote database has no general `orders` or `payments` tables yet, so payments for group-buying orders are not represented as if they existed.
