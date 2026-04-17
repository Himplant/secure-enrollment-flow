

## Updated Understanding

The user confirms Zoho Deal `2082094000401078644` (Antwin Morris) was **never marked as Paid in Zoho** — it has always been Cancelled. This means my earlier hypothesis (Zoho-said-paid backfill) is wrong. The fake `paid` enrollment row in our DB came from somewhere else.

## Revised Investigation Plan

I need to re-examine the actual source. Possibilities:

1. **Stripe webhook misfire** — a `checkout.session.completed` event from another patient/test got linked to Antwin's enrollment row.
2. **Manual admin action** — someone marked it paid via the admin dashboard (would show in `admin_audit_log`).
3. **Backfill bug** — an earlier backfill script set `status='paid'` on rows that weren't supposed to be (independent of Zoho status).
4. **`create-enrollment` or `regenerate-enrollment` bug** — initial creation set wrong status.
5. **`sync-credits` side effect** — even though sync only fetches Paid deals, maybe an old run when the deal had a different status created the row, or the fetch criteria changed historically.

## Step 1 — Forensic deep-dive on Antwin's row (read-only)

Pull every piece of evidence:
- `enrollments` row `f071c94d-…`: full column dump including `created_at`, `updated_at`, `paid_at`, `status`, all stripe IDs, `zoho_record_id`, `token_hash`, `terms_accepted_at`, `signature_data`, `consent_pdf_path`
- `enrollment_events` for that enrollment_id — chronological log of every state change
- `admin_audit_log` filtered to `resource_id = 'f071c94d-…'` OR `resource_summary` containing Antwin's email — see if any admin touched it
- `surgeon_credits` row(s) for Antwin — check `created_at`, `source`, `enrollment_id` link, `zoho_deal_id`
- `processed_stripe_events` — search for any event referencing Antwin's email (would need cross-check)
- `patients` row for Antwin — `created_at`, `surgeon_id`
- Any other `enrollments` rows for `AMorris19731944@gmail.com` (deleted ones won't show, but live duplicates would)

## Step 2 — Stripe cross-check

- `stripe.customers.list({ email: 'AMorris19731944@gmail.com' })` — does a customer exist?
- If yes, list `paymentIntents` and `checkout.sessions` — any successful $500 charge?
- Search Stripe by metadata for `enrollment_id = f071c94d-…` or Zoho deal `2082094000389432496`/`2082094000401078644`

## Step 3 — Check edge function logs

- `function_edge_logs` for `stripe-webhook`, `create-enrollment`, `sync-credits`, `regenerate-enrollment`, `mark-credit-issued` around the timestamps in `enrollment_events`
- Specifically the timestamp the row was first created and the timestamp `status` flipped to `paid`

## Step 4 — Identify the actual mechanism

Based on findings, classify the cause:
- (A) Stripe webhook with mismatched session → fix webhook patient-matching logic
- (B) Admin manual action → review who/when, no code fix needed
- (C) Backfill that set status=paid without Stripe verification → audit other rows from same batch, delete fakes
- (D) Application bug in create-enrollment → review code path

## Step 5 — Present findings + targeted fix

After diagnosis, return with:
- Exact root cause (with timestamps + log evidence)
- List of any other affected rows (same-bug cohort)
- One-off DB cleanup (delete Antwin's fake row + any siblings)
- Code/logic fix to prevent recurrence

## Step 6 — Add safeguard regardless of root cause

Add a database constraint or validation trigger: an enrollment cannot have `status='paid'` unless it has either a `stripe_payment_intent_id` OR an `admin_audit_log` entry explicitly marking it as externally paid. This prevents *any* future path from silently marking rows paid without traceable proof.

## Files involved (read-only investigation now; modifications in default mode after diagnosis)

- Read: `enrollments`, `enrollment_events`, `admin_audit_log`, `surgeon_credits`, `patients`, `processed_stripe_events` (via `supabase--read_query`)
- Read: Stripe customers/PIs (via `stripe--list_customers`, `stripe--list_payment_intents`)
- Read: edge function logs (via `supabase--analytics_query` or edge_function_logs)
- After diagnosis: the offending edge function source (likely `stripe-webhook/index.ts`, `sync-credits/index.ts`, or a backfill script in `supabase/functions/`)

I will NOT propose any guesswork fix until the forensic data is collected. The first action when default mode resumes is queries + Stripe lookups, not edits.

