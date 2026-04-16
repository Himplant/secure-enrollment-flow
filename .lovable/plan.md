

## Problems Identified

1. **Analytics data incomplete**: The analytics merges platform enrollments with `source='import'` credits, but all 125 credits are `source='zoho'` — so imported credits query returns 0. The 31 Zoho-only patients (who paid $500 but have no `enrollments` record) are missing from analytics entirely. Total paid should be 98, not 67.

2. **Consultant duplicates (Justin & Kyle)**: The `consultantNameMap` maps by first name prefix from platform enrollments. When Zoho credits with `consultant_email` like `kyle@himplant.com` don't match the map, they fall back to just "kyle" as a string. This creates two entries: "Kyle Himplant" (platform) and "kyle" (fallback). Same for Justin.

3. **Credits tab missing features**: Dispute and note features exist individually, but there's no refund option, no per-record audit trail view, and the multi-select bar only has "Mark All as Paid" and "Flag as Disputed" — missing bulk note, bulk resolve, and bulk refund.

4. **Super admin restriction for credit payments**: Currently any admin can mark credits as issued. The edge function checks `admin_users` but doesn't verify role = `super_admin`.

5. **Missing enrollment records for 31 Zoho-only patients**: These patients show $0 in profiles because they have no `enrollments` row.

## Plan

### Step 1: Create enrollment records for 31 Zoho-only patients
Database INSERT (not migration) to create "paid" enrollment records ($500 / 50000 cents) for the 31 patients who have `surgeon_credits` but no `enrollments`. Use data from their `surgeon_credits` records for dates and names.

### Step 2: Fix analytics to include all paid enrollments
Update `AdminDashboard.tsx`:
- Change the imported credits query to filter by `source='zoho'` instead of `source='import'`, OR simply rely on the now-complete `enrollments` table (after Step 1). Since all 98 paid patients will have enrollment records, the platform query alone will be sufficient.
- Remove the `importedCredits` merge logic since it's no longer needed.

### Step 3: Fix consultant name deduplication
Update the consultant name resolution to use a proper canonical name map:
```
justin@himplant.com → Justin Goddard
kyle@himplant.com → Kyle Himplant
ray@himplant.com → Ray Himplant
```
Store this as a static map rather than relying on first-name prefix matching. This eliminates the "kyle" vs "Kyle Himplant" duplicate.

### Step 4: Restrict credit payment approval to super_admin
Update `mark-credit-issued` edge function:
- For the mark-as-issued action, check `adminUser.role === 'super_admin'` and return 403 if not.
- Dispute, resolve, and add_note actions remain available to all admins.
Update the UI in `CreditsTab.tsx` to hide/disable the "Pay" and "Mark All as Paid" buttons unless the logged-in user is `super_admin`.

### Step 5: Add refund action to Credits tab
Add a "Refund" button for `issued` credits that:
- Changes `credit_status` back to `earned` (or a new `refunded` status)
- Logs the action in audit trail
- Only available to `super_admin`

Add a new `action: "refund"` handler in the edge function.

### Step 6: Add per-record audit trail view
Add a button on each credit row to view its full history from `admin_audit_log` filtered by `resource_id = credit.id`. Show as an expandable section or dialog with timestamped entries.

### Step 7: Add bulk actions for multi-select
Expand the bulk action bar to include:
- **Bulk Dispute** (already exists)
- **Bulk Mark as Paid** (already exists)
- **Bulk Resolve** (for disputed credits)
- **Bulk Refund** (for issued credits)
- **Bulk Add Note**

### Step 8: Fix date parsing in sync function
Update `parseZohoDate` in `sync-credits/index.ts` to use regex extraction instead of `new Date()` to prevent timezone shifts on December dates.

### Technical Details

**Files to modify:**
- `supabase/functions/sync-credits/index.ts` — fix `parseZohoDate`
- `supabase/functions/mark-credit-issued/index.ts` — add super_admin check for payment, add refund action
- `src/components/admin/CreditsTab.tsx` — add refund button, audit trail view, bulk actions, super_admin gating
- `src/pages/AdminDashboard.tsx` — fix consultant dedup, simplify analytics after enrollment backfill
- `src/components/admin/ConsultantDistributionCard.tsx` — no changes needed (fed correct data from parent)

**Database operations (INSERT tool, not migration):**
- Insert ~31 enrollment records for Zoho-only patients

**Props change:**
- `CreditsTab` needs to receive `adminRole` prop from `AdminDashboard` to gate super_admin actions

