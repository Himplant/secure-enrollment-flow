

## Problem

The `sync-credits` function pulls **all 1,151 "Paid" deals from Zoho CRM** and creates credit records for every one of them — even patients who never enrolled through the platform or the Excel import. This results in ~1,029 irrelevant "Unknown surgeon" records cluttering the Credits tab.

The user wants credits **only** for the ~163 patients who exist in the `patients` table (from the Excel import or platform enrollments).

## Plan

### Step 1: Clean up the database — delete non-matching credit records

Run a data operation to delete the ~1,029 surgeon_credits records whose `patient_email` does NOT match any patient in the `patients` table. This removes all the irrelevant Zoho deals.

```sql
DELETE FROM surgeon_credits
WHERE id NOT IN (
  SELECT sc.id FROM surgeon_credits sc
  JOIN patients p ON LOWER(TRIM(p.email)) = LOWER(TRIM(sc.patient_email))
  WHERE p.email IS NOT NULL
)
AND source = 'zoho';
```

### Step 2: Update `sync-credits` Edge Function — filter by known patients

Modify the sync logic so that after fetching deals from Zoho, it **only processes deals whose email matches a patient** in the `patients` table. Specifically:

1. Load all patient emails into a `Set` upfront
2. After fetching Zoho deals, filter: `deals.filter(d => d.Email && patientEmails.has(d.Email.toLowerCase().trim()))`
3. Only upsert/update records for these matched deals
4. This also makes the sync faster since it processes ~124 records instead of 1,151

The rest of the sync logic (surgeon resolution, credit calculation, email-match for imports, batch upsert) stays the same.

### Step 3: Verify imported records are preserved

The 2 existing `source = 'import'` records and any future Excel imports will remain untouched since they're not `source = 'zoho'`. The sync will update them when a matching Zoho deal is found (linking the `zoho_deal_id`), keeping surgery dates, stages, and credit calculations current.

### Technical Details

- **Edge Function**: `supabase/functions/sync-credits/index.ts` — add patient email filter after Zoho fetch
- **Database cleanup**: Delete ~1,029 rows from `surgeon_credits` where patient is not in `patients` table
- **No UI changes needed** — the Credits tab already groups by surgeon and shows the right data structure

