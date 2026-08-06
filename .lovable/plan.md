# International Consultations Module — Implementation Plan

Planning only. No application code, schema, policy, function, secret, route, or config is changed by this document.

---

## 1. Current-project risk assessment

What I inspected: `src/App.tsx` routing, `src/hooks/useAdminAuth.ts`, `src/components/admin/AdminProtectedRoute.tsx`, `supabase/functions/_shared/admin-auth.ts`, the 19 deployed edge functions, `supabase/config.toml`, and the live schema (11 public tables, 5 enums, `private.is_admin` / `private.has_admin_role` / `private.auth_user_email` helpers, 31 RLS policies).

| # | Risk | Severity | Mitigation baked into this plan |
|---|---|---|---|
| R1 | Single admin identity model (`admin_users`) is the only authorization surface; adding external users to it would give distributors and surgeons the same policy path as Himplant admins | Critical | Entirely separate `portal_users` / `portal_memberships` model + separate `private.` helper functions. `admin_users` untouched. |
| R2 | `stripe-webhook` is the single money-truth path for U.S. payments | Critical | No international logic ever enters it. Separate `intl-payment-webhook`, separate dedupe table, separate secrets. |
| R3 | MFA has already failed twice in this repo (unverified TOTP factors; `getAuthenticatorAssuranceLevel` unusable server-side, now solved via `jwtHasAal2`) | High | Admin MFA path frozen. Portal auth gets its own guard (`portal-auth.ts`) that never imports `admin-auth.ts`. |
| R4 | `surgeons` is Zoho-owned and has a documented history of duplicates, orphans, and wrong assignments | High | `clinic_id` on the consultation is the authoritative money-routing key; `surgeon_id` is descriptive. Never route a payment off a Zoho-synced field. |
| R5 | Existing enums (`enrollment_status`, `credit_status`, `payment_method_type`) are consumed by U.S. code and Zoho sync | High | Zero changes. All international states use new enums. |
| R6 | `AdminDashboard.tsx` (378 lines) hardcodes every tab; `CreditsTab.tsx` is 958 lines | Medium | Add a nav-group config array rather than more inline tabs; do not touch `CreditsTab`. |
| R7 | U.S. code assumes USD minor units throughout | Medium | International rows carry `currency` + `amount_minor`; new formatting helpers only. |
| R8 | Zoho sync functions (`sync-credits`, `sync-enrollment-statuses`, `sync-surgeons`) were recently stabilised after several incidents | High | New `intl-sync-zoho` only. No edits to the three existing sync functions. |
| R9 | Provider credentials for many independent merchants | Critical | `private.provider_credentials` (service-role only) or Vault. Never selectable from the browser under any role. |

### Explicitly untouched (full freeze list)

Routes: `/`, `/enroll/:token`, `/admin`, `/admin/login`.
Pages/components: `EnrollPage.tsx`, `Index.tsx`, `EnrollmentCard.tsx`, `EnrollmentStatus.tsx`, `TermsConsent.tsx`, `SignaturePad.tsx`, `CountdownTimer.tsx`, `StatusBadge.tsx`, `AdminLogin.tsx`, `AdminProtectedRoute.tsx`, `MfaChallenge.tsx`, `MfaEnrollTotp.tsx`, `MfaEnrollEmail.tsx`, `MfaSetupChoice.tsx`, and every existing `src/components/admin/*` tab.
Hooks/lib: `useAdminAuth.ts`, `src/lib/consultant.ts`, `src/lib/creditEconomics.ts`.
Tables: `enrollments`, `enrollment_events`, `patients`, `surgeon_credits`, `surgeons`, `policies`, `processed_stripe_events`, `admin_users`, `admin_audit_log`, `mfa_email_codes`.
Enums: `enrollment_status`, `credit_status`, `credit_source`, `payment_method_type`, `admin_role`.
Functions: `create-enrollment`, `admin-create-enrollment`, `get-enrollment`, `create-checkout-session`, `stripe-webhook`, `mark-refunded`, `mark-credit-issued`, `regenerate-enrollment`, `expire-enrollments`, `sync-credits`, `sync-enrollment-statuses`, `sync-surgeons`, `zoho-oauth-callback`, `test-zoho-token`, `send-test-email`, `send-admin-invite`, `reset-mfa-factors`, `send-mfa-email-code`, `verify-mfa-email-code`, and both `_shared/admin-auth.ts` and `_shared/consent-pdf.ts` / `_shared/send-confirmation-email.ts`.
Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ZOHO_*`, `RESEND_API_KEY`, `CRON_SECRET`, `ENROLLMENT_SHARED_SECRET`, `APP_URL`.
Storage: `consent-documents` bucket and its policies.

The only pre-existing files that change at all are `src/App.tsx` (added routes, flag-gated), `src/pages/AdminDashboard.tsx` (added nav group, flag-gated), and `supabase/config.toml` (new function blocks only). Nothing else.

---

## 2. Recommended architecture

Build inside this project, in a Lovable variant branched from production. A second standalone project is not advisable: Lovable Cloud gives each project its own Supabase instance, so a second project means a second auth user pool and a second database with no supported merge path — and the stated requirement is one app, one login. Isolation comes from additive schema + separate auth model + separate edge functions + feature flags, not from a separate project.

```text
                     Supabase Auth  (one user pool)
                    /                              \
      admin_users (TOTP/AAL2, frozen)      portal_users + portal_memberships
                    |                                     |
              /admin  shell                         /portal shell
        ┌───────────┴───────────┐             ┌────────────┴───────────┐
   US Enrollment          International    Distributor portal     Clinic portal
   (Stripe, frozen)       (adapters)
   stripe-webhook         intl-payment-webhook
   create-checkout-       intl-create-payment ── MercadoPago | PayPal | TestProvider
     session                                          (merchant = clinic/surgeon)
   sync-credits           intl-sync-zoho (outbox + retry)
```

Money never touches Himplant: the checkout is created **on the clinic's own connected merchant account**, so settlement is direct.

---

## 3. Role and permission matrix

Two identity planes. `admin_users.role` (`super_admin` | `admin` | `viewer`) is unchanged. New `portal_role` enum: `distributor_admin`, `distributor_staff`, `distributor_analyst`, `clinic_admin`, `clinic_staff`, `clinic_analyst`.

| Capability | Himplant super_admin | Himplant admin (ops) | Himplant viewer | distributor_admin | distributor_staff | distributor_analyst | clinic_admin | clinic_staff | clinic_analyst |
|---|---|---|---|---|---|---|---|---|---|
| U.S. enrollment data | Full | Existing perms only | Existing | No | No | No | No | No | No |
| Intl consultations — all | Full | Full | Read | — | — | — | — | — | — |
| Intl consultations — own scope | — | — | — | Read | Read | Read | Read+workflow | Read+workflow | Read |
| Create payment invitation | Yes | Yes | No | No | No | No | No | No | No |
| Schedule / reschedule / no-show | Yes | Yes | No | No | No | No | Yes | Yes | No |
| Record consultation outcome | Yes | Yes | No | No | No | No | Yes | Yes | No |
| Record surgery funnel | Yes | Yes | No | No | No | No | Yes | Yes | No |
| Change amount/currency after creation | No (immutable post-send) | No | No | No | No | No | No | No | No |
| Manually mark online payment approved | No | No | No | No | No | No | No | No | No |
| Connect/disconnect merchant account | Yes (admin-assisted) | No | No | No | No | No | Yes | No | No |
| Select clinic active provider | Yes | Yes | No | No | No | No | Yes | No | No |
| Invite portal staff | Yes | Yes | Own distributor only | Own distributor only | No | No | Own clinic only | No | No |
| View provider credentials | Never | Never | Never | Never | Never | Never | Never | Never | Never |
| Platform config / flags / countries | Yes | No | No | No | No | No | No | No | No |
| Platform audit log | Yes | Scoped | No | Own-org events only | No | No | Own-clinic events only | No | No |
| Distributor/region management | Yes | Yes | Read | Read own | Read own | Read own | No | No | No |

Distributor staff invitation: yes, `distributor_admin` may invite `distributor_staff` and `distributor_analyst` within their own distributor, never `distributor_admin` (that stays a Himplant action). Same rule shape for `clinic_admin` inviting `clinic_staff` / `clinic_analyst`.

---

## 4. Distributor and regional hierarchy

```text
Himplant
  └── Distributor ──< distributor_regions >── Region ──< country
        └── (assignment) ──< clinic_distributors >── Clinic
                                    └── clinic_surgeons ──> surgeons (existing, read-only link)
                                    └── portal_memberships ──> portal_users
```

First release: **one primary distributor per clinic**, modelled through the join table `clinic_distributors` with a `is_primary boolean` and a partial unique index (`unique (clinic_id) where is_primary`). Using a join table from day one — rather than `clinics.distributor_id` — means multi-distributor support later is a data change (drop the partial unique index, add a role column), not a migration of every RLS policy.

Distributor scope resolves as the **union** of: clinics explicitly assigned via `clinic_distributors`, plus clinics whose `region_id` is in the distributor's `distributor_regions`. Authorization uses IDs only — never names, never email domains.

---

## 5. Proposed database schema

All new tables live in `public` unless noted, all follow the repo's mandatory order: CREATE TABLE → GRANT → ENABLE RLS → CREATE POLICY. No `anon` grant anywhere except the two public read paths noted. All get `created_at` / `updated_at` + the existing `update_updated_at_column()` trigger.

New enums (all international-specific, no existing enum touched): `intl_country` (MX, CO, CL), `portal_role`, `portal_org_type` (distributor, clinic), `payment_provider` (mercado_pago, paypal, test, stripe_connect), `provider_account_status` (pending, onboarding, connected, expired, revoked, disabled), `intl_payment_status`, `intl_consultation_status`, `intl_surgery_status`, `provider_connection_method` (oauth, partner_onboarding, admin_managed).

**regions** — geographic grouping. Cols: `id`, `country intl_country`, `name`, `code`, `is_active`. Unique `(country, code)`. Index on `country`. RLS: admin all; portal users read regions in their scope. Writes: admin only, direct.

**distributors** — partner organisations. Cols: `id`, `name`, `legal_name`, `primary_contact_email`, `is_active`, `zoho_id`. Unique `name`, unique `zoho_id`. RLS: admin all; portal read own row only. Writes: admin only.

**distributor_regions** — FK `distributor_id`→distributors, `region_id`→regions. Unique `(distributor_id, region_id)`. Index both columns. RLS: admin all; distributor users read own rows. Writes: admin only.

**clinics** — Cols: `id`, `name`, `country intl_country`, `region_id`→regions, `city`, `timezone`, `default_currency char(3)`, `contact_email`, `contact_phone`, `active_provider payment_provider NULL`, `is_active`, `zoho_id`. Index `(country)`, `(region_id)`. RLS: admin all; distributor read in-scope; clinic members read own. Writes: admin direct; `clinic_admin` may update a whitelist (contact fields, timezone, `active_provider`) via edge function only.

**clinic_distributors** — FK `clinic_id`, `distributor_id`, `is_primary bool`. Unique `(clinic_id, distributor_id)` + partial unique on primary. RLS: admin all; distributor read own. Writes: admin only.

**clinic_surgeons** — links a clinic to an existing `surgeons.id`. Cols: `clinic_id`, `surgeon_id`→surgeons, `consultation_fee_minor int`, `currency`, `is_active`. Unique `(clinic_id, surgeon_id)`. This is how doctor-specific fees are held **without adding a column to `surgeons`**. RLS: admin all; distributor read in-scope; clinic read own. Writes: admin + clinic_admin (fee changes) via edge function, audited.

**portal_users** — Cols: `id`, `user_id`→auth.users (nullable until accepted), `email citext`, `full_name`, `is_active`, `invited_by`, `invited_at`, `accepted_at`, `last_login_at`, `mfa_required bool`. Unique `email`, unique `user_id`. RLS: self-read; org peers read within same org via membership; admin all. Writes: edge function only (`send-portal-invite`).

**portal_memberships** — the authorization core. Cols: `id`, `portal_user_id`→portal_users, `org_type portal_org_type`, `distributor_id NULL`, `clinic_id NULL`, `role portal_role`, `is_active`, `granted_by`, `granted_at`, `revoked_at`. Check constraint: exactly one of `distributor_id` / `clinic_id` is non-null and matches `org_type`. Unique `(portal_user_id, org_type, coalesce(distributor_id, clinic_id), role)`. Indexes on `portal_user_id`, `clinic_id`, `distributor_id`. RLS: self-read; org admins read own org; **all writes admin-only or via edge function** — a portal user must never be able to insert their own membership.

**consultation_patients** — separate from U.S. `patients`. Cols: `id`, `full_name`, `email citext`, `phone`, `country intl_country`, `preferred_language`, `zoho_record_id`, `created_by_admin_id`. Unique `(email, country)` (soft — allow null email). RLS: admin all; portal read only via EXISTS on an in-scope consultation. Writes: edge function only.

**consultations** — the central record. Cols:
`id`, `token_hash text not null`, `token_last4`, `expires_at`
`clinic_id`→clinics **(authoritative routing key, not null)**, `surgeon_id`→surgeons NULL, `region_id`→regions, `distributor_id`→distributors (denormalised at creation for RLS speed, immutable)
`patient_id`→consultation_patients
`created_by_admin_user_id`, `agent_email`
`amount_minor int not null`, `currency char(3) not null`, `provider payment_provider not null`, `provider_account_id`→provider_accounts **(recipient snapshot, immutable after `sent`)**, `recipient_external_merchant_id text` (snapshot)
`payment_status intl_payment_status`, `consultation_status intl_consultation_status`, `surgery_status intl_surgery_status` — **three independent columns, deliberately not one enum**
`provider_payment_id`, `provider_checkout_url`, `paid_at`, `failed_at`, `refunded_at`, `disputed_at`
`first_contact_at`, `scheduled_at`, `rescheduled_count`, `consulted_at`, `no_show_at`, `closed_at`
`surgery_recommended_at`, `surgery_scheduled_at`, `surgery_completed_at`
`policy_id`→international_policies, `terms_accepted_at`, `terms_accept_ip`, `terms_accept_user_agent`, `terms_sha256`, `signature_data`
`zoho_module`, `zoho_record_id`, `notes`
Unique `token_hash`. Indexes: `(clinic_id, payment_status)`, `(distributor_id, created_at)`, `(payment_status, consultation_status)`, `(provider, provider_payment_id)`.
RLS below. Writes: creation and all payment fields via edge function (service role) only; workflow fields via `portal-update-consultation`.

**consultation_events** — append-only. Cols: `id`, `consultation_id`, `event_type`, `event_data jsonb`, `actor_type` (system/admin/portal/provider), `actor_id`, `created_at`. Index `(consultation_id, created_at)`. RLS: read scoped like consultations; **no update, no delete for anyone** (`USING (false)`); insert service-role only.

**consultation_tasks** — SLA/follow-up queue. Cols: `id`, `consultation_id`, `clinic_id`, `task_type` (first_contact, schedule, follow_up, outcome), `due_at`, `completed_at`, `completed_by`. Index `(clinic_id, due_at) where completed_at is null`. RLS: clinic + distributor scoped read; clinic write via edge function.

**provider_accounts** — merchant account per clinic (optionally per surgeon). Cols: `id`, `clinic_id`, `surgeon_id NULL`, `provider`, `country`, `currency`, `external_merchant_id`, `status provider_account_status`, `connection_method provider_connection_method`, `capabilities jsonb`, `onboarding_status`, `is_active`, `last_verified_at`, `connected_by`, `connected_at`, `disconnected_at`. Unique `(clinic_id, provider, coalesce(surgeon_id,'0000...'))`. **Contains no tokens.** RLS: admin all; clinic reads own (masked view of `external_merchant_id` in UI); distributor reads status only.

**private.provider_credentials** — `provider_account_id`, `access_token`, `refresh_token`, `expires_at`, `scope`, `environment`, `encrypted_at`, `rotated_at`, `created_by`. Schema `private`, **no grants to `anon` or `authenticated` at all**, service_role only. Prefer Supabase Vault for the token values. Never selected outside an edge function.

**processed_provider_events** — dedupe. Cols: `provider`, `external_event_id`, `received_at`, `raw_payload jsonb`, `processing_status`, `error`. PK `(provider, external_event_id)`. RLS deny-all to `authenticated`; service_role only.

**international_policies** — Cols: `id`, `country`, `language`, `clinic_id NULL`, `provider NULL`, `version`, `effective_at`, `terms_text`, `terms_url`, `privacy_url`, `content_sha256`, `cancellation_policy`, `no_show_policy`, `refund_exceptions`, `is_active`. Unique `(country, language, coalesce(clinic_id,...), version)`. RLS: admin write; **`anon` SELECT allowed for active policies only** (the payment page must render them pre-login). Independent of the U.S. `policies` table.

**international_country_settings** — Cols: `country`, `is_enabled`, `default_currency`, `allowed_providers payment_provider[]`, `min_fee_minor`, `max_fee_minor`, `default_language`, `sla_first_contact_hours`. PK `country`. Admin write, portal read.

**app_feature_flags** — Cols: `key text pk`, `enabled bool default false`, `scope jsonb`, `updated_by`, `updated_at`. Admin write; `authenticated` and `anon` read (flags are not secrets, and the payment page needs them). Seeded with the nine required keys, all `false`.

**integration_audit_logs** — outbound integration + credential audit. Cols: `id`, `integration` (zoho/mercado_pago/paypal), `direction`, `entity_type`, `entity_id`, `request_summary jsonb`, `response_status`, `error`, `attempt`, `created_at`. Admin read only; service-role write; no update/delete.

**intl_zoho_outbox** — retry queue. Cols: `id`, `consultation_id`, `payload jsonb`, `status` (pending/sent/failed/dead), `attempts`, `next_attempt_at`, `last_error`. Index `(status, next_attempt_at)`. Service-role only.

---

## 6. Exact RLS strategy

Three new SECURITY DEFINER helpers in the existing `private` schema (same pattern as `private.is_admin`, `search_path = public, private`, revoked from PUBLIC/anon/authenticated except EXECUTE where needed):

```sql
private.portal_clinic_ids(_user uuid) returns setof uuid
  -- clinics from active clinic memberships
private.portal_distributor_ids(_user uuid) returns setof uuid
  -- distributors from active distributor memberships
private.portal_scope_clinic_ids(_user uuid) returns setof uuid
  -- union of: portal_clinic_ids
  --        + clinics via clinic_distributors for portal_distributor_ids
  --        + clinics whose region_id ∈ distributor_regions of those distributors
private.has_portal_role(_user uuid, _role portal_role) returns boolean
```

Consultation policies:

```sql
-- Himplant admins (unchanged helper)
create policy "Admins read consultations" on public.consultations
  for select to authenticated using (private.is_admin(auth.uid()));

-- Distributor + clinic users, single predicate
create policy "Portal reads in-scope consultations" on public.consultations
  for select to authenticated
  using (clinic_id in (select private.portal_scope_clinic_ids(auth.uid())));

-- No portal INSERT / UPDATE / DELETE policy at all.
create policy "Deny portal writes" on public.consultations
  for update to authenticated using (private.is_admin(auth.uid()))
  with check (private.is_admin(auth.uid()));
create policy "Deny deletes" on public.consultations
  for delete to authenticated using (false);
```

Consequence: a distributor or clinic user changing a URL, or issuing a raw PostgREST query for another clinic's consultation, gets zero rows — the predicate is evaluated in the database, not in React. All portal mutations go through `portal-update-consultation`, which re-checks membership server-side and writes with the service role, so the column whitelist cannot be bypassed either.

`consultation_patients` and `consultation_tasks` use an EXISTS against `consultations` (different table, so no recursion):

```sql
using (exists (select 1 from public.consultations c
               where c.patient_id = consultation_patients.id
                 and c.clinic_id in (select private.portal_scope_clinic_ids(auth.uid()))))
```

Clinic-only boundary: clinic members are scoped by `clinic_id`, never by `surgeon_id` — surgeon linkage is Zoho-derived and has a bad reliability history (R4). A surgeon who works at two clinics gets two memberships.

Credentials: `private.provider_credentials` has no grant to `authenticated`, so no policy can accidentally expose it. `provider_accounts` exposes only merchant IDs and status; the UI masks all but the last 4 characters.

Every new table also gets an explicit `for all to anon using (false)` deny, except `international_policies` and `app_feature_flags` (active rows only) and the token-scoped consultation read used by the public payment page — which is not a policy at all but a service-role lookup inside `intl-get-consultation`.

---

## 7. Authentication and login routing

One Supabase user pool. Two membership tables, two guards, two shells.

- `/admin/login` — unchanged component, unchanged mandatory TOTP.
- `/portal/login` — new component, same `supabase.auth` calls, portal branding.
- Post-login resolution order: if `private.is_admin` → `/admin` (admin wins, with a "Switch to partner portal" item in the header for dual-role users). Else if exactly one active membership → `/portal/distributor` or `/portal/clinic`. Else if multiple → `/portal/select-workspace`.
- Active workspace stored in `sessionStorage` + React context; every portal query is additionally filtered by it in the UI, but the RLS predicate remains the union of all memberships, which is the security boundary.

MFA policy recommendation:
- Himplant super_admin / admin / viewer: mandatory TOTP, AAL2 enforced in every admin edge function (unchanged).
- `distributor_admin`: mandatory TOTP (they see multi-clinic financial data).
- `clinic_admin`: mandatory TOTP **only for the merchant-connection and fee-change actions** (step-up), optional for daily use. This keeps surgeon onboarding frictionless while protecting money-moving actions.
- `clinic_staff` / analysts: optional TOTP, with a per-clinic setting an admin can force on.
- All portal invites are single-use, expiring, email-verified links.

New guard: `supabase/functions/_shared/portal-auth.ts` exporting `requirePortalUser(req, { role?, clinicId?, distributorId?, requireAal2? })`. It validates the JWT, loads active memberships, and returns `{ userId, memberships }`. It does **not** import `admin-auth.ts`, so no international change can weaken admin auth.

---

## 8. Admin navigation design

Keep the single `/admin` shell. Replace the flat `TabsList` with a nav-group config array:

- **U.S. Enrollment** — Transactions, Patients, Credits, Credit Economics, Policies (all existing components, untouched, just re-grouped).
- **International Consultations** — Consultations, Payment Invitations, Reconciliation, Reports.
- **Partner Management** — Distributors, Regions, Clinics, Surgeon Links, Portal Users, Provider Accounts.
- **Platform Administration** — Users & Roles, Feature Flags, Country Settings, International Policies, Audit Log.

The last three groups render only when `international_module_enabled` is true. With every flag false, the admin sees exactly today's tab set.

---

## 9. Distributor portal design

`/portal/distributor` — KPI header + funnel. `/surgeons`, `/clinics`, `/consultations` (filterable table, region/clinic/status/date), `/reports`.

Metrics (all computed over the RLS-scoped set, so cross-distributor leakage is structurally impossible): links created, approved payments, pending payments, paid-awaiting-contact, median time to first contact, median payment→scheduled, scheduled, completed, no-show rate, surgery recommended / scheduled / completed rates, refund rate, dispute rate, and conversion split by clinic, surgeon, country, and Himplant agent.

No payment credentials, no merchant tokens, no U.S. data, no other distributor — enforced by RLS, not by hiding UI.

## 10. Surgeon and clinic portal design

`/portal/clinic` — work queues: new paid consultations, awaiting contact, upcoming, overdue follow-ups (driven by `consultation_tasks` + `international_country_settings.sla_first_contact_hours`).
`/portal/clinic/consultations` and `/:id` — patient contact details, amount + currency, payment status and provider reference (read-only), and the workflow actions: contact, schedule, reschedule, no-show, complete, record general outcome, surgery recommended / scheduled / completed.
`/portal/clinic/payments` — provider connection status, connect/disconnect (clinic_admin only, step-up MFA), active-provider selection.
`/portal/clinic/team` — invite/deactivate `clinic_staff` and `clinic_analyst`.
`/portal/clinic/settings` — contact info, timezone, per-surgeon consultation fee.

Explicitly out of scope for display: diagnoses, examination findings, clinical notes, uploaded medical records. Outcomes are administrative enums only.

---

## 11. Mercado Pago connection design

Mercado Pago supports **OAuth for marketplaces/platforms**: the seller authorises the platform application and the platform receives a seller access token. Payments are then created either with the seller's token, or with the platform token specifying the seller as collector under the marketplace model. Both settle to the seller.

- `intl-provider-oauth-start` builds the MP authorize URL with `state` = signed, short-lived nonce bound to `provider_account_id`.
- `intl-provider-oauth-callback` (`verify_jwt = false`) exchanges the code, stores tokens in `private.provider_credentials`, sets `provider_accounts.status = connected`, records capabilities and country/currency, writes an audit event, and returns an HTML response that is **escaped the same way `zoho-oauth-callback` was hardened** (that XSS fix is the reference implementation).
- Refresh tokens are rotated by a cron function before expiry; `last_verified_at` is refreshed on each successful `getMerchantStatus`.
- Country nuance: MP operates per-country (MLM Mexico, MCO Colombia, MLC Chile) with separate site IDs and currencies. The adapter stores `site_id` in `capabilities` and validates that a consultation's country/currency matches the account's site before creating a checkout.

## 12. PayPal connection design

PayPal's equivalent is **Partner Referrals / multiparty onboarding**: the platform creates a referral, the seller completes PayPal-hosted onboarding, and the platform receives a `merchant_id`. Orders are then created with `PayPal-Auth-Assertion` (or purchase-unit `payee.merchant_id`) so funds settle to the seller.

- `intl-provider-oauth-start` (PayPal branch) creates a partner referral and returns the action URL.
- `intl-provider-oauth-callback` captures `merchantIdInPayPal`, then calls the merchant-integrations status endpoint to confirm `payments_receivable` and `primary_email_confirmed`; only then does `status` become `connected`.
- Availability caveat to validate in sandbox before Phase 6: PayPal partner onboarding coverage differs by country in LATAM. If a target country is not supported, that country ships with Mercado Pago only.

**Do not assume a single global Mercado Pago or PayPal credential can collect for every surgeon** — each clinic must have its own connected merchant account; that is the entire point of the direct-to-surgeon requirement.

## 13. Admin-managed credential process

Fallback only, for clinics that cannot complete self-onboarding.

1. Restricted to Himplant `super_admin`, AAL2 enforced.
2. Credentials are submitted **only** to `intl-connect-provider-admin`, never inserted from the browser into a table, never placed in a normal column.
3. Stored in Supabase Vault (or encrypted into `private.provider_credentials`) — service-role read only.
4. Never returned to the frontend. Subsequent reads yield a masked identifier only (`****4821`).
5. Recorded: who, when, provider, clinic, country, environment (sandbox/live), connection_method = `admin_managed`.
6. Supports rotation and revocation; revocation sets `provider_accounts.status = revoked` and immediately blocks new checkouts.
7. Writes an `integration_audit_logs` row and a `consultation_events`-style admin audit entry.

## 14. Provider selection rules

Resolution order when creating a payment invitation:
1. Country must have `international_country_settings.is_enabled` and the corresponding country flag true.
2. Provider must be in the country's `allowed_providers` **and** its global flag (`mercado_pago_enabled` / `paypal_enabled`) must be true.
3. The clinic must have a `provider_accounts` row for that provider with `status = connected`, `is_active`, and a currency matching the consultation currency.
4. If `clinics.active_provider` is set and valid → use it. Otherwise, if exactly one valid account exists → use it. If more than one and the country setting allows patient choice → present the choice on the payment page. Otherwise → block.
5. **If no valid recipient account exists, the invitation cannot be created or activated.** This is enforced in `intl-create-consultation`, not in the UI.

Once the consultation reaches `sent`, `clinic_id`, `provider`, `provider_account_id`, `recipient_external_merchant_id`, `amount_minor`, and `currency` are immutable — enforced by a `BEFORE UPDATE` trigger that raises on change, plus an event log entry on any attempt.

Degraded states handled explicitly: provider temporarily disabled (flag off → existing unpaid links show "temporarily unavailable"), connection expired/revoked (link blocked, clinic and Himplant notified), fallback provider (if the clinic has a second connected account and the country allows fallback), no connected provider (creation blocked).

## 15. Payment-provider adapter structure

```text
supabase/functions/_shared/providers/
  types.ts          PaymentProvider interface + normalized types
  mercadopago.ts
  paypal.ts
  test-provider.ts  simulates pending/approved/failed/expired/refunded/disputed
  registry.ts       getProvider(name) -> PaymentProvider
  money.ts          minor-unit + multi-currency helpers (separate from US helpers)
```

Interface: `startMerchantConnection`, `completeMerchantConnection`, `getMerchantStatus`, `disconnectMerchant`, `createCheckout`, `getPayment`, `verifyWebhook`, `normalizePaymentStatus`, `getAvailablePaymentMethods`, and `refundPayment` declared but throwing `NotSupported` until explicitly approved (the fee is non-refundable by policy).

## 16. Webhook and reconciliation design

`intl-payment-webhook` (`verify_jwt = false`), one function, provider dispatched by path/header, provider-specific secret (`MP_WEBHOOK_SECRET`, `PAYPAL_WEBHOOK_ID`):

1. Verify signature/authenticity with the provider's own scheme. Reject otherwise, log to `integration_audit_logs`.
2. Insert into `processed_provider_events` with the raw payload; unique-violation → 200 and stop (idempotent).
3. **Fetch the payment from the provider API** — Mercado Pago sends thin ID-only notifications and PayPal payloads can be replayed; never trust the payload body.
4. Verify all five: recipient merchant ID matches `consultations.recipient_external_merchant_id`; amount matches `amount_minor`; currency matches; external reference matches the consultation ID; provider matches. Any mismatch → do not mark paid, set `processing_status = mismatch`, log, alert.
5. Update `payment_status`, timestamps, and `consultation_status` → `awaiting_clinic_contact`; insert `consultation_events`; create the `first_contact` task.
6. Enqueue the Zoho payload into `intl_zoho_outbox`. **Zoho is never called inline** — a CRM outage cannot fail a payment webhook.
7. Return 200 quickly.

The browser success redirect only navigates to `/consult/:token/pending`, which polls `intl-get-consultation`; it is never proof of payment. No portal role can transition an online payment to approved — the `portal-update-consultation` whitelist simply does not contain payment columns.

Daily reconciliation cron: list provider payments for the window, compare against `consultations`, report orphans and mismatches to an admin reconciliation view.

## 17. Zoho synchronization design

U.S. sync (`sync-credits`, `sync-enrollment-statuses`, `sync-surgeons`, `zoho-oauth-callback`, `test-zoho-token`) is frozen.

Recommendation: a **custom Zoho module `International_Consultations`** rather than Deals. Deals already carry U.S. enrollment/credit semantics and the existing sync functions match on them; overloading Deals would risk the U.S. pipeline. Store `zoho_module` per row so the code stays module-agnostic if that decision changes.

Field mapping: distributor (lookup), clinic (lookup), surgeon (lookup to existing Surgeons module), consultation payment status, consultation operational status, surgery conversion status, assigned Himplant agent (owner), country, currency, provider, provider transaction reference, amounts, and key timestamps.

Transport: outbox pattern. `intl-sync-zoho` runs on cron with `CRON_SECRET` (same guard as existing background jobs), drains `intl_zoho_outbox` with exponential backoff, moves rows to `dead` after N attempts, and logs every attempt to `integration_audit_logs`. Inbound pull handles clinic-side cancellations, mirroring how `sync-enrollment-statuses` handles U.S. cancels — but as a separate function.

---

## 18. File-by-file implementation map

New frontend:
```text
src/pages/ConsultationPay.tsx                 /consult/:token
src/pages/ConsultationSuccess.tsx             /consult/:token/success
src/pages/ConsultationPending.tsx             /consult/:token/pending
src/pages/ConsultationCanceled.tsx            /consult/:token/canceled
src/pages/PortalLogin.tsx
src/pages/PortalSelectWorkspace.tsx
src/pages/DistributorDashboard.tsx
src/pages/ClinicDashboard.tsx
src/components/portal/PortalProtectedRoute.tsx
src/components/portal/PortalShell.tsx
src/components/portal/WorkspaceSwitcher.tsx
src/components/portal/ConsultationTable.tsx
src/components/portal/ConsultationDetail.tsx
src/components/portal/ScheduleDialog.tsx
src/components/portal/OutcomeDialog.tsx
src/components/portal/SurgeryFunnelCard.tsx
src/components/portal/ProviderConnectCard.tsx
src/components/portal/TeamManagement.tsx
src/components/portal/distributor/{RegionFilter,ClinicList,SurgeonList,DistributorReports}.tsx
src/components/admin/intl/{ConsultationsTab,ReconciliationTab,IntlReportsTab}.tsx
src/components/admin/intl/{DistributorsTab,RegionsTab,ClinicsTab,ClinicSurgeonsTab,PortalUsersTab,ProviderAccountsTab}.tsx
src/components/admin/intl/{CreateConsultationModal,AdminConnectProviderModal}.tsx
src/components/admin/platform/{FeatureFlagsTab,CountrySettingsTab,IntlPoliciesTab}.tsx
src/hooks/usePortalAuth.ts
src/hooks/useFeatureFlags.ts
src/hooks/useWorkspace.ts
src/lib/featureFlags.ts
src/lib/intlStatus.ts
src/lib/intlMoney.ts
src/lib/adminNav.ts
```

New edge functions: `intl-create-consultation`, `intl-get-consultation`, `intl-create-payment`, `intl-payment-webhook`, `intl-provider-oauth-start`, `intl-provider-oauth-callback`, `intl-provider-status`, `intl-connect-provider-admin`, `intl-disconnect-provider`, `intl-refresh-provider-tokens`, `intl-reconcile-payments`, `portal-update-consultation`, `send-portal-invite`, `intl-sync-zoho`, `intl-expire-consultations`, plus `_shared/portal-auth.ts` and `_shared/providers/*`.

Modified (three files, additive only): `src/App.tsx` (flag-gated routes), `src/pages/AdminDashboard.tsx` (nav-group config), `supabase/config.toml` (`verify_jwt = false` blocks for `intl-get-consultation`, `intl-create-payment`, `intl-payment-webhook`, `intl-provider-oauth-callback`).

New secrets: `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_BN_CODE`, `INTL_TOKEN_SECRET`, `PROVIDER_CREDENTIAL_KEY`. None read by any existing function.

---

## 19. Additive migration sequence

| # | Migration | Depends on |
|---|---|---|
| M1 | New enums | — |
| M2 | `app_feature_flags` + seed nine keys, all false | M1 |
| M3 | `regions`, `distributors`, `distributor_regions` | M1 |
| M4 | `clinics`, `clinic_distributors`, `clinic_surgeons` | M3 |
| M5 | `portal_users`, `portal_memberships` | M4 |
| M6 | `private.portal_clinic_ids`, `portal_distributor_ids`, `portal_scope_clinic_ids`, `has_portal_role` | M5 |
| M7 | `provider_accounts`, `private.provider_credentials`, `processed_provider_events` | M4 |
| M8 | `international_policies`, `international_country_settings` | M1 |
| M9 | `consultation_patients`, `consultations`, `consultation_events`, `consultation_tasks` + immutability trigger | M4, M7, M8 |
| M10 | `integration_audit_logs`, `intl_zoho_outbox` | M9 |
| M11 | RLS policies for all of the above (after M6 exists) | M6–M10 |

Every migration: CREATE → GRANT → ENABLE RLS → POLICY, `updated_at` trigger reusing the existing `public.update_updated_at_column()`. No DROP, no RENAME, no ALTER of any existing table or enum, no backfill, no auth record movement.

## 20. Rollback strategy

- **Level 1 (seconds):** set `international_module_enabled = false` in `app_feature_flags`. All new routes, nav, and portal APIs go dark. U.S. path unaffected because it never reads the new tables.
- **Level 2:** disable a single country or provider flag; existing paid consultations remain readable to admins.
- **Level 3:** un-deploy the `intl-*` and `portal-*` edge functions individually. Never redeploy `stripe-webhook` as part of an international release.
- **Level 4 (hard):** drop in reverse order M11 → M1. Nothing outside the new set references them, so the drop is clean.
- Take a database backup immediately before M1 and before the Phase 8 pilot.
- Emergency kill switch: a single `international_module_enabled=false` write, plus a webhook-level guard that returns 503 and leaves the provider to retry — so in-flight payments are never lost, only deferred.

## 21. Feature-flag strategy

Build-time: `VITE_ENABLE_INTL` gates the lazy route imports so the international bundle isn't even shipped when off.
Runtime: `app_feature_flags` rows read via `useFeatureFlags` (client) and a `_shared/flags.ts` check inside every `intl-*` function — a disabled flag must fail server-side too, not just hide UI.
Keys, all defaulting false: `international_module_enabled`, `international_mexico_enabled`, `international_colombia_enabled`, `international_chile_enabled`, `mercado_pago_enabled`, `paypal_enabled`, `surgeon_portal_enabled`, `distributor_portal_enabled`.
Hierarchy: module flag gates everything; country flags gate creation in that country; provider flags gate adapter availability; portal flags gate `/portal/*`. With all eight false the application behaves byte-for-byte like today's production.

## 22. U.S. regression-test plan

Run before every international release; any failure blocks the release.

1. Admin login succeeds. 2. Admin TOTP challenge succeeds and yields AAL2. 3. `/enroll/:token` opens for an active token. 4. Policy/terms render with correct version. 5. Stripe card checkout completes in test mode. 6. ACH flow completes. 7. `stripe-webhook` signature validates and the event is deduped. 8. Enrollment transitions to `paid` with correct timestamps. 9. Refund via `mark-refunded` updates status and clears credits. 10. Consent PDF generates and uploads to `consent-documents`. 11. Confirmation email sends, including the `siam@himplant.com` BCC. 12. `surgeon_credits` rows are created with correct expirations. 13. `sync-credits` and `sync-enrollment-statuses` run clean, zero duplicates. 14. Dashboard analytics, Credit Economics, and consultant grouping match pre-release values. 15. All existing admin users retain their roles. 16. Route inventory diff shows no change to `/`, `/enroll/:token`, `/admin`, `/admin/login`.

Automate 7, 8, 12, 13 as vitest/edge-function tests; the rest as a signed manual checklist.

## 23. International security-test plan

- Distributor A queries a Consultation belonging to Distributor B by ID via raw PostgREST → 0 rows.
- Clinic staff manipulates `/portal/clinic/consultations/:id` with a foreign ID → 404, no data in the network response.
- Portal user attempts to INSERT a `portal_memberships` row for themselves → denied.
- Any authenticated role attempts to SELECT `private.provider_credentials` → permission denied.
- Portal user attempts to UPDATE `consultations.payment_status` / `amount_minor` directly → denied by RLS; via `portal-update-consultation` → rejected by the column whitelist.
- Amount/recipient tamper after `sent` → trigger raises, event logged.
- Webhook replay with a valid but already-processed event ID → idempotent 200, no state change.
- Webhook with a forged signature → rejected and logged.
- Webhook whose payment recipient differs from the stored merchant ID → not marked paid, mismatch logged.
- Revoked provider account → new checkout blocked.
- Distributor report totals compared against an admin-side full query filtered to that distributor → identical, proving no leakage and no under-reporting.
- Deactivated portal user → immediate loss of access on next request.

## 24. Controlled release sequence

Phase 1 architecture only (variant, flags, schema, RLS, portal identity; no provider, no production nav) → Phase 2 test provider simulating pending/approved/failed/expired/refunded/disputed across all roles and stages → Phase 3 distributor portal + RLS tests → Phase 4 surgeon/clinic portal + RLS tests → Phase 5 Mercado Pago sandbox (onboarding, OAuth, checkout, webhook, reconciliation, recipient verification) → Phase 6 PayPal sandbox (partner onboarding, same checks) → Phase 7 Zoho mappings, outbox, retry, relationship sync → Phase 8 controlled pilot: one distributor, one clinic, one surgeon, one country, one provider, capped volume, daily reconciliation, daily U.S. regression monitoring. Then country-by-country activation MX → CO → CL, each gated on a clean pilot week.

## 25. Technical risks and mitigations

1. **Direct-to-surgeon settlement is the load-bearing assumption.** If Mercado Pago or PayPal partner onboarding is unavailable in a target country, that country cannot launch as designed. Validate in sandbox in Phase 5/6 *before* building portal payment UI.
2. **PayPal LATAM partner-onboarding coverage varies.** Treat PayPal as optional per country; the flag model already allows MX-only Mercado Pago.
3. **Token lifecycle across many merchants.** Expired seller tokens silently break checkouts. Mitigate with `intl-refresh-provider-tokens` cron, `last_verified_at`, and a portal banner when status drifts from `connected`.
4. **MFA regression risk (R3).** Portal auth must not share code with admin auth; add a regression test asserting an AAL1 admin JWT is still rejected by `admin-auth.ts`.
5. **Zoho custom module approval/turnaround.** Ships in Phase 7 behind the outbox, so payment recording never depends on it.
6. **Surgeon-record data quality (R4).** Clinic is the security and routing boundary; `surgeon_id` is descriptive only.
7. **Multi-currency correctness.** Separate `intlMoney.ts`; never reuse USD-cent helpers. Add unit tests for CLP (zero-decimal) — a classic minor-unit bug.
8. **Admin dashboard growth (R6).** Refactor the tab list into `src/lib/adminNav.ts` as the first frontend change, before adding any international tab.
9. **Distributor scope creep via region reassignment.** Region changes retroactively alter visibility; `consultations.distributor_id` is snapshotted at creation and region-based access is additive, so history stays auditable.
10. **Pre-launch refactor recommendation:** extract the MFA state machine from `useAdminAuth.ts` into a tested shared hook before Phase 4, so the portal reuses proven logic instead of a second copy.
