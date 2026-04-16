

## Problem

**All 122 Zoho-synced credit records have NULL values for `credit_750_expires`, `credit_500_expires`, and `surgery_date`**, even though you updated these fields in the CRM. This causes `calculateCredit()` to always return `$0 / pending` — even for "Surgery Completed" patients.

The root cause is likely that the Zoho API field names with `$` prefix (`$750_Credit_Applies_Until`, `$500_Credit_Applies_Until`) are not being correctly read from the JSON response. JavaScript object destructuring with `$` prefixed keys can behave unexpectedly, or Zoho may be returning these under different property names.

## Plan

### Step 1: Add diagnostic logging to see actual Zoho response

Add a `console.log` for the first 2-3 deals returned by Zoho to see the actual field names and values in the response. This will reveal whether:
- The `$` fields are named differently (e.g., `_750_Credit_Applies_Until`)
- `Surgery_Date` is returned under a different key
- The values are present but in an unexpected format

### Step 2: Fix field mapping based on actual Zoho response

Once we see the real field names, update the `ZohoDeal` interface and the field references in the sync loop to match. The `$` prefix fields may need bracket notation or a different property name.

### Step 3: Re-sync all credits

After fixing the field mapping, trigger a sync that will correctly populate `credit_750_expires`, `credit_500_expires`, and `surgery_date` for all records. The `calculateCredit()` function already handles the logic correctly — it just needs non-null inputs.

### Technical Details

- **File**: `supabase/functions/sync-credits/index.ts`
- **Diagnosis**: Deploy with diagnostic logging, call the function, check logs
- **Fix**: Update Zoho field name mapping based on actual API response
- **No database migration needed** — the columns exist, they're just not being populated

