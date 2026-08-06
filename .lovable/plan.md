# International Consultations Module — Implementation Plan

## Recommendation up front: build it here (Approach A)

Do **not** create a second Lovable project and merge later. Approach B looks safer but is not:

- The backend is a single Lovable Cloud (Supabase) instance. A second project gets its own database, its own auth users, and its own edge functions. There is no supported "merge two projects" operation — merging means hand-porting every migration, re-creating every user, and reconciling two divergent `admin_users`/`surgeons` tables.
- The requirement is explicitly **one unified app and one login**. Two projects means two identity providers; surgeons enrolled in project B would have to be re-invited in project A, and MFA factors (already fragile here — see risks) do not transfer.
- The live surface at risk is small and well isolated: `/enroll/:token` plus the Stripe webhook. Everything new is additive — new tables, new routes, new edge functions. Nothing in the U.S. flow needs to change to add the module.

Safety comes from **additive schema + feature flag + separate edge functions**, not from a separate project.

---

## 1. Architecture and phased rollout

One app, three audiences, one auth system:

```text
                 ┌──────────────── Supabase Auth (single user pool) ────────────────┐
                 │  admin_users (MFA/AAL2)   portal_users (surgeon / office staff)  │
                 └──────────────────────────────────────────────────────────────────┘
                        │                                 │
        /admin (existing + new intl tabs)          /portal (new, scoped to clinic)
                        │                                 │
      ┌─────────────────┴───────────────┐                 │
   US enrollment (Stripe, unchanged)   Intl consultations (provider adapter)
      stripe-webhook                    intl-payments-webhook  (separate function)
      create-checkout-session           intl-create-payment
                        └──────────── Zoho sync (separate module + function) ────────┘
```

Phases:

1. **Foundations** — new tables (`clinics`, `provider_accounts`, `consultations`, `consultation_events`, `portal_users`), role helpers in the `private` schema, RLS. No UI. Feature flag off.
2. **Admin-side CRUD** — new "International" tab group in the existing admin dashboard: create consultation invitation, list/filter, status timeline. Payments still stubbed (manual "mark paid").
3. **Payment adapter + Mercado Pago** — provider abstraction, surgeon OAuth connect flow, checkout preference creation, webhook. Sandbox first.
4. **Surgeon/office portal** — `/portal` routes, invite flow, restricted views.
5. **Zoho sync for international** — separate module/edge function, one-way then two-way.
6. **Enable flag in production**, country by country (MX → CO → CL).

---

## 2. Routes and navigation

Public / patient facing:

| Route | Purpose |
|---|---|
| `/c/:token` | International consultation payment page (mirrors `/enroll/:token`, different component tree) |
| `/c/:token/success` | Post-payment confirmation |
| `/c/:token/canceled` | Payment abandoned |

Portal (surgeon + office staff):

| Route | Purpose |
|---|---|
| `/portal/login` | Shared login screen (same Supabase auth, portal branding) |
| `/portal` | Clinic dashboard — assigned consultations only |
| `/portal/consultations/:id` | Detail: payment status, scheduling, outcome |
| `/portal/settings` | Clinic profile, staff list (surgeon role only) |
| `/portal/payments` | Connected payment account status + connect/reconnect |

Admin (existing `/admin`, add tabs — do not create a second dashboard shell):

- `International → Consultations`
- `International → Clinics & Surgeons`
- `International → Payment Accounts`
- Existing tabs untouched.

Login unification: keep one `/admin/login` component but route post-auth by role — admins to `/admin`, portal users to `/portal`. `/portal/login` is a thin themed wrapper over the same logic so the two audiences never see each other's shell.

---

## 3. Auth / authorization redesign

Preserve exactly what exists: `admin_users` + TOTP + `jwtHasAal2` on every admin edge function.

Add, without touching `admin_users`:

- `portal_users` table: `user_id`, `email`, `clinic_id`, `role` (`surgeon` | `office_staff`), `invited_at`, `accepted_at`, `is_active`.
- New enum `portal_role`.
- `private.portal_clinic_id(uuid)` — SECURITY DEFINER, returns the caller's `clinic_id` (or NULL). Same pattern as the existing `private.is_admin`.
- `private.has_portal_role(uuid, portal_role)`.
- MFA policy: **admins keep mandatory TOTP**. Portal users get optional TOTP (surgeons abroad often can't handle forced enrollment) — enforce it only for `surgeon` role if you want; recommend optional at launch, configurable per clinic later.
- New hook `usePortalAuth` mirroring `useAdminAuth`; do not overload `useAdminAuth` with a second role model.
- New `PortalProtectedRoute` component; `AdminProtectedRoute` stays as-is.
- Edge functions: add `supabase/functions/_shared/portal-auth.ts` with `requirePortalUser(req)` returning `{ userId, clinicId, role }`. Do not extend `admin-auth.ts` — keeping the two guards separate prevents an international bug from weakening admin auth.

---

## 4. Data model

**Extend nothing that the live flow depends on.** `enrollments`, `surgeon_credits`, `patients`, `policies` stay untouched. The only optional extension is `surgeons.clinic_id` (nullable) to link existing Zoho-synced surgeons to an international clinic — nullable, no default change, safe for `sync-surgeons`.

New tables (all in `public`, all with GRANTs + RLS):

`clinics`
- `id`, `name`, `country` (`MX`|`CO`|`CL` enum `intl_country`), `city`, `currency`, `timezone`, `zoho_id`, `is_active`

`provider_accounts` — one connected payment account per clinic per provider
- `id`, `clinic_id` FK → `clinics`, `provider` (enum `payment_provider`: `mercado_pago`, `stripe_connect`, `manual`), `external_account_id`, `status` (`pending`|`connected`|`revoked`), `connected_at`, `metadata jsonb`
- Access tokens/refresh tokens **not** stored here in plaintext — store in a `private.provider_credentials` table readable only by service_role, or in Supabase Vault.

`consultation_patients` (separate from U.S. `patients` — different lifecycle, no credit logic)
- `id`, `name`, `email`, `phone`, `country`, `preferred_language`, `zoho_record_id`

`consultations`
- `id`, `token_hash`, `token_last4` (same hashed-token pattern as `enrollments`)
- `clinic_id` FK, `surgeon_id` FK → `surgeons` (nullable), `patient_id` FK → `consultation_patients`
- `agent_user_id` (who created it), `agent_email`
- `amount_minor int`, `currency`, `provider`, `provider_payment_id`, `provider_checkout_url`
- `status` enum `consultation_status`: `created`, `sent`, `opened`, `processing`, `paid`, `failed`, `expired`, `canceled`
- `scheduled_at`, `consulted_at`, `outcome` enum `consultation_outcome`: `pending`, `completed`, `no_show`, `converted_to_surgery`, `declined`
- `surgery_converted_at`, `expires_at`, `notes`
- `terms_version`, `terms_url`, `terms_accepted_at`, `terms_accept_ip` (non-refundable disclosure must be captured)
- `zoho_module`, `zoho_record_id`

`consultation_events` — append-only audit, mirrors `enrollment_events`
- `id`, `consultation_id` FK, `event_type`, `event_data jsonb`, `actor`, `created_at`

`processed_provider_events` — webhook idempotency, mirrors `processed_stripe_events`
- `provider`, `external_event_id` (composite PK)

---

## 5. RLS strategy

Pattern follows what's already in the repo (`private.is_admin`), so nothing new conceptually.

- Every new table: deny-all to `anon`; `authenticated` grants only.
- Admin: `USING (private.is_admin(auth.uid()))` for full read/write on all new tables.
- Portal users, on `consultations`:
  - SELECT: `clinic_id = private.portal_clinic_id(auth.uid())`
  - UPDATE: same predicate, but restrict writable columns via a trigger or a dedicated edge function — portal users may set `scheduled_at`, `consulted_at`, `outcome`, `notes` and **never** `amount_minor`, `status`, or `clinic_id`. Safest: portal writes go through `portal-update-consultation` edge function; RLS UPDATE stays admin-only.
  - No DELETE for portal users.
- `clinics` / `provider_accounts`: portal SELECT limited to own `clinic_id`; only `surgeon` role may initiate a provider connect.
- `portal_users`: a user may read rows in their own clinic; only `surgeon` role may insert/deactivate staff in their own clinic; admins full access.
- `consultation_patients`: portal SELECT allowed only when a consultation for that patient belongs to the caller's clinic (EXISTS subquery against `consultations` — no recursion since it's a different table).
- Never reference the policy's own table inside its predicate; use the `private.` SECURITY DEFINER helpers.

---

## 6. Payment provider adapter

Complete isolation from Stripe enrollment. New code path, new functions, new webhook, new idempotency table.

```text
supabase/functions/_shared/providers/
  types.ts        -> interface PaymentProvider {
                       createCheckout(input): { url, externalId }
                       verifyWebhook(req): { ok, event }
                       parseEvent(event): { externalId, status, paymentId, amount }
                       getPayment(id)
                     }
  mercadopago.ts  -> implements PaymentProvider
  manual.ts       -> offline/bank-transfer fallback for a clinic without a provider
  index.ts        -> getProvider(name)
```

Edge functions (all new, none shared with Stripe):

- `intl-create-consultation` — admin/agent only (AAL2), mints token, inserts row, emails patient.
- `intl-get-consultation` — public, token-hash lookup, returns only what the payment page needs.
- `intl-create-payment` — public, called from `/c/:token`; resolves the clinic's `provider_account`, creates the checkout on the **surgeon's** account so funds settle to them (Mercado Pago: create the preference using the connected seller's access token, or the marketplace `collector_id`).
- `intl-provider-webhook` — `verify_jwt = false`, signature-verified, writes to `processed_provider_events` first, then updates the consultation.
- `intl-provider-oauth-start` / `intl-provider-oauth-callback` — surgeon connects their Mercado Pago account; callback stores tokens in the private credentials table. Modeled on the existing `zoho-oauth-callback`, including the XSS-safe response already fixed there.

Guardrails: `stripe-webhook/index.ts` and `create-checkout-session/index.ts` are **not** modified. Secrets for Mercado Pago are new names (`MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`) and are never read by Stripe functions.

Non-refundable: enforce by never exposing a refund action on international rows, and by capturing explicit consent text at checkout, versioned like the existing `policies` table (reuse `policies` with a `scope` column, or add `consultation_terms` — recommend a nullable `scope` column on `policies`, since that table is admin-only and low risk).

---

## 7. Zoho CRM synchronization

Do not touch `sync-credits` or `sync-enrollment-statuses` — they are load-bearing and were recently stabilized. Add:

- `intl-sync-zoho` edge function, cron-triggered with `CRON_SECRET` (same guard as existing background jobs).
- Direction: Lovable → Zoho on state change (payment paid, scheduled, consulted, converted), plus Zoho → Lovable pull for cancellations, mirroring how `sync-enrollment-statuses` handles Erik-Singer-style cancels.
- Surgeon/clinic resolution reuses the existing `fetchAndUpsertSurgeonFromZoho` helper; extend it (not rewrite) to also populate `clinic_id` when the Zoho surgeon record carries a country/clinic field.
- Separate Zoho module or a `Consultation_Type` field on Deals — decide with the CRM owner; the plan assumes a distinct module `Consultations` with `zoho_module` stored per row so the code stays module-agnostic.

---

## 8. Migration and rollback

- Every migration is **purely additive**: `CREATE TABLE`, `CREATE TYPE`, new `private.` functions, plus one nullable `surgeons.clinic_id` and one nullable `policies.scope`. No column drops, no type changes, no policy rewrites on existing tables.
- Rollback = turn the feature flag off. The U.S. flow never reads the new tables, so orphaned tables are inert.
- Hard rollback = `DROP TABLE` the new tables in reverse FK order; nothing else references them.
- Deploy edge functions individually; never redeploy `stripe-webhook` as part of an international release.
- Before each phase: verify `/enroll/:token` end-to-end in Stripe test mode and confirm the webhook still records events.

## 9. Safe prototyping

- **Feature flag** `VITE_ENABLE_INTL` (build-time) plus a DB-backed `app_settings` row for runtime toggling per environment. Admin tabs and `/portal` + `/c/:token` routes render only when enabled.
- **Lovable variants / branch** for phases 3–4 (the payment adapter and portal), since those are the riskiest; merge back once the sandbox Mercado Pago flow is verified.
- Seed a `manual` provider clinic first so the whole lifecycle can be exercised without any real payment integration.
- Keep production flag off until phase 6.

## 10. File-by-file map

New:

```text
src/pages/ConsultationPay.tsx              /c/:token
src/pages/ConsultationSuccess.tsx
src/pages/PortalLogin.tsx
src/pages/PortalDashboard.tsx
src/pages/PortalConsultationDetail.tsx
src/components/portal/PortalProtectedRoute.tsx
src/components/portal/PortalShell.tsx
src/components/portal/ConsultationTable.tsx
src/components/portal/ProviderConnectCard.tsx
src/components/admin/intl/ConsultationsTab.tsx
src/components/admin/intl/ClinicsTab.tsx
src/components/admin/intl/ProviderAccountsTab.tsx
src/components/admin/intl/CreateConsultationModal.tsx
src/hooks/usePortalAuth.ts
src/lib/featureFlags.ts
src/lib/consultationStatus.ts
supabase/functions/_shared/portal-auth.ts
supabase/functions/_shared/providers/{types,mercadopago,manual,index}.ts
supabase/functions/intl-create-consultation/index.ts
supabase/functions/intl-get-consultation/index.ts
supabase/functions/intl-create-payment/index.ts
supabase/functions/intl-provider-webhook/index.ts
supabase/functions/intl-provider-oauth-start/index.ts
supabase/functions/intl-provider-oauth-callback/index.ts
supabase/functions/intl-sync-zoho/index.ts
supabase/functions/portal-update-consultation/index.ts
supabase/functions/send-portal-invite/index.ts
```

Modified (small, additive edits only):

```text
src/App.tsx                     add /c/:token, /portal/* routes behind the flag
src/pages/AdminDashboard.tsx    add International tab group behind the flag
supabase/config.toml            verify_jwt=false for intl-get-consultation,
                                intl-create-payment, intl-provider-webhook,
                                intl-provider-oauth-callback
supabase/functions/sync-surgeons/index.ts   optional clinic_id passthrough
index.html                      unchanged (noindex stays)
```

Untouched: `stripe-webhook`, `create-checkout-session`, `create-enrollment`, `get-enrollment`, `sync-credits`, `mark-refunded`, `mark-credit-issued`, `admin-auth.ts`, `useAdminAuth.ts`, `AdminProtectedRoute.tsx`, `EnrollPage.tsx`.

## 11. Risks and pre-launch refactors

1. **Money routing.** Funds must land in the surgeon's account, not Himplant's. Mercado Pago's marketplace/connected-seller model must be validated in sandbox before any UI is built — this is the single assumption that can invalidate the design.
2. **MFA fragility.** This repo has already had two MFA incidents (unverified factors, `getAuthenticatorAssuranceLevel` failing server-side). Adding a second user class multiplies that surface. Refactor before launch: extract the MFA state machine out of `useAdminAuth` into a shared, tested hook.
3. **`AdminDashboard.tsx` and `CreditsTab.tsx` size.** 378 and 958 lines respectively; the dashboard already carries every tab. Split the tab registry into a config array before adding four more tabs.
4. **Surgeon identity.** `surgeons` is Zoho-owned and has had duplicate/orphan issues. Linking clinics to it means Zoho sync bugs can now break payment routing. Mitigate: `consultations.clinic_id` is the authoritative routing key; `surgeon_id` is descriptive only.
5. **Currency handling.** U.S. code assumes USD cents. New code must store `currency` per row and never reuse the existing formatting helpers unchanged.
6. **Webhook idempotency.** Mercado Pago retries aggressively and sends thin notifications (ID only, fetch-to-confirm). The webhook must fetch payment state from the API rather than trusting the payload.
7. **PII/consent.** International consent records and the non-refundable disclosure need the same hash-and-store treatment the U.S. flow already has; do not ship phase 3 without it.
8. **One login, two shells.** Users who are both admin and clinic staff need a deterministic landing rule — recommend admin wins, with a shell switcher in the header.
