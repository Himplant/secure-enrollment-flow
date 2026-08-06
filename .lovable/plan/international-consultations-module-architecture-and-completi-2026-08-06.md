# International Consultations Module — Architecture and Completion Plan

## Current state (verified in this project)

Much of the isolated international module already exists in this codebase. Verified now:

- Runtime flags in `app_feature_flags`: `international_module_enabled`, `international_mexico_enabled`, `international_colombia_enabled`, `international_chile_enabled`, `mercado_pago_enabled`, `paypal_enabled`, `surgeon_portal_enabled`, `distributor_portal_enabled`, `test_provider_enabled`, `provider_setup_enabled` — **all false**.
- Build flag `VITE_ENABLE_INTL` exists in `.env` (currently `"true"` in this dev environment; must be false/absent for production builds until launch).
- Routes: US `/`, `/enroll/:token`, `/admin/login`, `/admin` untouched. International routes `/consult/:token`, `/consult/:token/pending`, `/consult/:token/success`, `/portal/login`, `/portal`, `/portal/payment-account` are all behind the flag gate.
- Separate international tables exist (consultations, consultation_patients, consultation_events, consultation_tasks, consultation_messages, consultation_payment_attempts, consultation_policy_snapshots, distributors, distributor_surgeons, portal_users, portal_memberships, provider_accounts, provider_platform_configs, processed_provider_events, international_policies, international_country_settings, intl_zoho_outbox, integration_audit_logs), plus `private` schema tables for encrypted credentials and OAuth state.
- Separate edge functions: `intl-*`, `provider-*`, `portal-*`. US `stripe-webhook`, `create-checkout-session`, `create-enrollment`, `get-enrollment`, `sync-credits`, `mark-refunded` are untouched and carry no international branching.

So this plan is a **gap-closing plan**, not a greenfield build.

## Explicitly untouched U.S. assets

Tables: `enrollments`, `patients`, `surgeon_credits`, `enrollment_events`, `processed_stripe_events`, `policies`, `admin_users`, `admin_audit_log`.
Functions: `create-checkout-session`, `stripe-webhook`, `create-enrollment`, `admin-create-enrollment`, `get-enrollment`, `regenerate-enrollment`, `expire-enrollments`, `mark-refunded`, `mark-credit-issued`, `sync-credits`, `sync-enrollment-statuses`, `sync-surgeons`, `zoho-oauth-callback`.
Routes: `/`, `/enroll/:token`, `/admin/login`, `/admin` and all admin tabs. Admin MFA (AAL2) model unchanged. Stripe secrets and webhook endpoint unchanged.

## Role and permission model (as designed, to be completed)

Two identity surfaces on one Supabase user pool:

- `admin_users` (existing, MFA/AAL2 required) → `/admin`. Super admin sees everything; operations admin is scoped by role but never granted new U.S. financial settings.
- `portal_users` + `portal_memberships` (new) → `/portal`. Membership carries `org_type` (surgeon | distributor), `surgeon_id` or `distributor_id`, and `role` (surgeon_admin, surgeon_staff, surgeon_analyst, distributor_admin, distributor_staff, distributor_analyst).

Hierarchy is Himplant → Distributor → Surgeon → Consultation. Clinics and regions were deliberately collapsed: surgeons already carry `country` from the Zoho surgeon module, and `distributor_surgeons` maps oversight. Expanding later to clinics means adding a `clinics` table plus a `clinic_id` on consultations without touching what exists.

Permission matrix (short form):

| Capability | Super admin | Ops admin | Distributor admin | Distributor staff/analyst | Surgeon admin | Surgeon staff | Analyst |
|---|---|---|---|---|---|---|---|
| U.S. data | yes | per existing role | no | no | no | no | no |
| All intl consultations | yes | yes | assigned surgeons only | assigned, read-mostly | own surgeon only | own surgeon only | read only |
| Edit scheduling/outcome | yes | yes | no | no | yes | yes | no |
| Connect/disconnect provider | yes | no | no | no | yes | no | no |
| Platform config, flags, credentials | yes | no | no | no | no | no | no |
| Mark a payment approved manually | never (webhook only) | | | | | | |

## Remaining work

1. **Distributor portal** — `/portal/distributor` views (surgeons, consultations, reports) scoped through `portal_memberships` → `distributor_surgeons`. Currently only the surgeon-side portal dashboard and payment-account page exist.
2. **Workspace switcher** — `/portal/select-workspace` for users holding more than one membership; admins default to `/admin`.
3. **Surgeon portal completion** — team invite/deactivate screen, consultation detail actions (reschedule, no-show, surgery funnel), clinic-level analytics.
4. **PayPal adapter** — partner onboarding, checkout, webhook verification, reconciliation. Registry currently holds `test` and `mercado_pago` only; PayPal must not be selectable until its adapter is registered.
5. **Reporting** — distributor and surgeon metric queries (time-to-contact, scheduling, no-show, surgery conversion, refund/dispute rates), computed server-side and scoped by membership.
6. **Zoho international mapping polish** — outbox already exists; finish surgeon/distributor relationship fields and status mapping, keep webhooks non-blocking.
7. **Test-provider driven role/stage QA** — exercise every stage with `test_provider_enabled` on in a non-production context.
8. **MFA policy for portal users** — recommend: required for distributor_admin and surgeon_admin, optional (email OTP) for staff and analysts.

## RLS strategy (to verify and fill gaps before launch)

- Consultations: portal reads only via `portal_memberships` join (own surgeon, or a surgeon in the caller's `distributor_surgeons`). Admin reads via the existing accepted-admin helper.
- All portal writes go through `intl-portal-*` edge functions that re-derive scope server-side from the bearer token; direct table writes stay denied.
- Credentials live only in the `private` schema, reachable exclusively through security-definer functions called by service-role edge functions. No token, secret, or webhook key is ever selectable by `authenticated`.
- Payment terms (amount, currency, provider, recipient) are frozen by the existing immutability trigger once a link leaves draft.

## Migrations

All additive. No drops, renames, U.S. enum changes, U.S. RLS rewrites, or U.S. backfills. Order per step: new table → GRANT → enable RLS → policies → indexes. Rollback = flip the runtime flag off first (instant kill switch), then drop only the newly added international objects; U.S. paths are unaffected either way.

## Release sequence

Phase A distributor portal + RLS security tests → Phase B surgeon portal completion → Phase C reporting → Phase D PayPal sandbox → Phase E Zoho mapping → Phase F single-country pilot (one distributor, one surgeon, Mercado Pago, daily reconciliation).

Before each release, run the U.S. regression checklist: admin login + MFA, `/enroll/:token` render, policy render, Stripe card and ACH checkout, webhook signature validation, paid-enrollment update, refund, consent PDF, confirmation email, credit creation, Zoho status sync, dashboard analytics, unchanged permissions and routes. Any failure blocks the international release.

## Risks

- Flag leakage: a production build with `VITE_ENABLE_INTL=true` exposes routes even with runtime flags off — gate the production env var explicitly.
- Provider credential sprawl: rotation and revocation paths must be exercised, not just written.
- Zoho outbox backlog silently growing — add an admin visibility card for `intl_zoho_outbox` failures.
- PayPal multiparty onboarding requires partner approval; without it, PayPal stays admin-managed-credential only, which is weaker and should remain the exception.

No code, schema, or configuration changes will be made until this plan is approved.
