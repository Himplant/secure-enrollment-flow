# Simplify the international model: surgeons only

Remove the clinic and region layers. A consultation belongs to a **surgeon**, and the surgeon's **country** comes from the Zoho CRM Surgeons module. Distributors stay, but only as a support/analytics role layered on top of surgeons — nothing in the payment flow depends on them.

```text
Himplant
  └── Surgeon (country from Zoho, fee, payment account)
        └── Consultation → payment link → patient

Distributor (support role) ── assigned surgeons ──> read-only/assist view
```

## What changes for you

- **Surgeons are the only org unit.** No clinics, no regions to create. The surgeons you already sync from Zoho are the list; country and city are pulled from the Zoho address fields.
- **International Setup becomes 4 tabs:** International Surgeons, Distributors, Consultation Terms, Portal Users.
- **International Surgeons tab:** shows every synced surgeon, lets you mark which are international, confirm/override the country, and set the consultation fee, currency, and payment account (test or Mercado Pago) per surgeon.
- **Creating a consultation:** pick a surgeon (fee pre-fills), enter the patient, get the link. No clinic step.
- **Distributors:** create a distributor, assign specific surgeons to it. Distributor portal users see only transactions, patients, and analytics for their assigned surgeons. Removing a distributor never breaks a surgeon's payments.
- **Portal logins:** surgeon users (own consultations) and distributor users (their assigned surgeons).
- **"View as" for the Himplant team:** from the admin dashboard, super admins and admins can open the portal exactly as a chosen surgeon or distributor sees it (read-only by default), so you can test and support without their credentials. Plus a demo surgeon + demo distributor kept for safe click-through testing.

## Technical plan

### Database migration

- Drop `clinics`, `clinic_surgeons`, `clinic_distributors`, `regions`, `distributor_regions` (plus their policies/triggers). The one seeded demo clinic is the only data affected.
- `surgeons`: add `consultation_fee_minor`, `currency`, and keep `country` / `city` / `is_international` (already added, populated by Zoho sync).
- `consultations`: drop `clinic_id` and `region_id`; make `surgeon_id NOT NULL`; keep `country`, `provider`, `provider_account_id`, `distributor_id` (nullable, informational).
- `provider_accounts`: `surgeon_id NOT NULL`, drop `clinic_id`.
- `international_policies`: replace `clinic_id` with nullable `surgeon_id`; country + language remains the primary lookup.
- `consultation_tasks`: replace `clinic_id` with `surgeon_id`.
- New `distributor_surgeons (distributor_id, surgeon_id)` join table with GRANTs + RLS.
- `portal_memberships`: `org_type` enum becomes `surgeon | distributor`; `clinic_id` → `surgeon_id`; roles become `surgeon_admin`, `surgeon_staff`, `distributor_admin`, `distributor_staff`, `distributor_analyst`.
- Rewrite the security-definer scope helpers to return surgeon IDs (own surgeon, or all surgeons assigned to the distributor) and repoint every RLS policy that referenced clinic scope.
- Enable the country row in `international_country_settings` for each country a surgeon operates in.

### Edge functions

- `intl-create-consultation`: resolve country/fee/provider account from the surgeon instead of the clinic; keep the country + provider flag checks.
- `intl-get-consultation`, `intl-create-payment`, `intl-payment-webhook`: swap clinic joins for surgeon joins.
- `_shared/portal-auth.ts`: scope by surgeon IDs (direct membership or distributor assignment) instead of clinic IDs.
- `intl-portal-*`: filter on `surgeon_id IN scope`; distributor roles are read-only except link resend.
- New `intl-admin-portal-preview`: admin-only (AAL2) endpoint returning the portal payload for a chosen surgeon/distributor, powering "View as".

### Frontend

- Delete `ClinicsSection.tsx`, `RegionsSection.tsx`, `ClinicSurgeonsSection.tsx`; add `IntlSurgeonsSection.tsx` and `DistributorSurgeonsSection.tsx`.
- `IntlSetupTab.tsx`: four tabs, walkthrough text rewritten for the surgeon-first flow.
- `ProviderAccountsSection.tsx` and `PortalUsersSection.tsx`: keyed to surgeons/distributors.
- `CreateConsultationModal.tsx`: surgeon picker (country + fee shown) replaces the clinic/surgeon pair.
- Portal dashboard/sheet: surgeon labels instead of clinic; distributor view adds a surgeon column and a simple per-country analytics summary.
- `PortalDashboard` accepts an admin preview mode banner ("Viewing as …") when opened through "View as".
- Regenerate Supabase types after the migration.
