

## Problem

The `sync-credits` function treats `patients.surgeon_id` as the source of truth for surgeon assignment, only falling back to Zoho's surgeon field when the patient has no surgeon assigned. This means:

- Evan Leigh's surgeon was set to Dr. Elist when his patient record was first created
- Zoho was later corrected to Dr. Tajkarimi
- Sync runs, sees `patients.surgeon_id` is set, ignores Zoho → record stays on Elist forever

This bug affects **every patient** whose surgeon changes in Zoho.

## Fix Plan

### Step 1: Make Zoho the source of truth for surgeon assignment in sync-credits

In `supabase/functions/sync-credits/index.ts`, reverse the priority:

1. **First** resolve surgeon from Zoho's `Surgeon` lookup (using `Surgeon.id` → match against `surgeons.zoho_id`, which is the most reliable)
2. **Then** fall back to `Surgeon_Name_Lookup` name match
3. **Only** fall back to `patients.surgeon_id` if Zoho has no surgeon at all

Also: load the `surgeons` table including `zoho_id` so we can map by Zoho ID directly (the most accurate match — names can have typos, IDs cannot).

### Step 2: When the surgeon changes, also update `patients.surgeon_id`

After resolving the correct surgeon from Zoho, if it differs from the patient's current `surgeon_id`, update the patient record so that:
- The Patients tab also reflects the correct surgeon
- Future enrollment lookups use the correct surgeon
- The two stay in sync

### Step 3: One-time corrective sync for Evan + audit

After deploying the fix:
- Run sync-credits → Evan automatically moves to Dr. Tajkarimi in `surgeon_credits`
- Run a query to find all patients where `patients.surgeon_id` differs from their latest `surgeon_credits.surgeon_id` (the corrected value) and report them so we can confirm before the patient table is updated, OR let the sync auto-fix them all

### Files to modify

- `supabase/functions/sync-credits/index.ts` — surgeon resolution priority + patient surgeon update

### Technical detail

```
Resolution order (new):
1. Zoho deal.Surgeon.id → surgeons.zoho_id (exact match)
2. Zoho deal.Surgeon_Name_Lookup → surgeons.name (fuzzy)
3. patients.surgeon_id (last resort only)

Side effect: if resolved surgeon ≠ patients.surgeon_id, update patients.surgeon_id
```

