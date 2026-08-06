# Make the International module usable

## Why nothing works yet

The flags are already on (module, Colombia, Mercado Pago, test provider, both portals — Mexico and Chile are still off), but the international tables are empty: 0 distributors, 0 regions, 0 clinics, 0 clinic-surgeon links, 0 provider accounts, 0 terms policies, 0 portal users. The "Create consultation" modal only lists clinics and surgeons already linked to a clinic, so it shows nothing — and there is no admin screen anywhere to create that data.

So the module isn't broken; it has no org structure behind it.

## What gets built

### 1. Surgeon country from Zoho (source of truth)

Add `country`, `city` and `is_international` to the surgeon record and populate them from the Zoho Surgeons module address fields (Country / Mailing Country). The surgeon sync writes them on every run, so a surgeon flipped to Mexico in Zoho becomes an international surgeon here automatically. Country strings are normalized to MX / CO / CL; anything else stays domestic and is untouched by the international rail.

### 2. New "International Setup" admin tab (super admin)

One tab with sub-sections, each a simple list + add/edit form:

- **Distributors** — name, legal name, contact, active; assign regions.
- **Regions** — country, name, code.
- **Clinics** — name, country, region, city, timezone, currency, contacts, active provider; link to one or more distributors.
- **Clinic surgeons** — pick a clinic, then attach surgeons. The surgeon picker is pre-filtered to Zoho-sourced international surgeons for that clinic's country, with a toggle to show all. Set the consultation fee per surgeon.
- **Payment accounts** — per clinic/surgeon provider account (test provider works today; Mercado Pago slots in later without UI change).
- **Consultation terms** — country/language terms text and version used on the patient payment page.
- **Portal users** — invite a clinic or distributor contact by email and grant a membership (role + clinic/distributor scope). This is what makes `/portal` reachable for them.

### 3. Demo data so you can click through today

Seed one Colombia distributor + region + clinic, attach a real international surgeon from Zoho (or a placeholder if none is flagged Colombia yet), create a test-provider payment account and a Colombian terms record.

### 4. Walkthrough

A short in-app "How this works" card on the International tab: create consultation → copy patient link → patient pays on `/consult/:token` → status moves through the lifecycle → clinic sees it in `/portal`.

## Technical notes

- Schema: add `country`, `city`, `is_international` to `surgeons`; no other schema changes — every other table already exists with RLS.
- Surgeon country mapping lives in `sync-surgeons` and the enrollment-time Zoho fetch helper, so both paths agree.
- New admin CRUD components under `src/components/admin/intl/setup/`, mounted from `AdminDashboard` behind the existing build + runtime flags and `super_admin` role.
- Portal invites reuse the existing invite email path and write `portal_users` + `portal_memberships`; no new auth surface.
- U.S. enrollment code stays untouched.

## Open item

Mexico and Chile flags are currently off. Say the word and I'll turn them on once you have clinics there.
