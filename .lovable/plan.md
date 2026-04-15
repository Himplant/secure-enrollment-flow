

# Surgeon Credit Tracking and Reporting System

## Summary

Build a full credit tracking system that:
1. Pulls deal data from Zoho CRM to calculate credits per surgeon
2. Imports historical enrollment data from the uploaded Excel file (pre-Lovable patients)
3. Tracks which credits have been issued vs. pending vs. forfeited
4. Allows admins to mark credits as "issued" for accounting
5. Generates per-surgeon credit reports

## What Gets Built

### 1. New Database Tables

**`surgeon_credits`** — stores each enrollment's credit eligibility and issuance status:
- `id`, `surgeon_id` (FK to surgeons), `surgeon_name`, `patient_name`, `patient_email`
- `enrollment_date`, `surgery_date`, `stage` (from Zoho)
- `credit_750_expires`, `credit_500_expires` (the two deadline dates)
- `credit_amount` (computed: 750, 500, or 0)
- `credit_status` (enum: `pending`, `earned`, `forfeited`, `issued`)
- `issued_at`, `issued_by` (admin email who marked it issued)
- `zoho_deal_id` (for dedup), `source` (enum: `zoho`, `import` — to distinguish CRM-synced vs Excel-imported)
- `consultant_email` (the owner field)
- `enrollment_id` (nullable FK to local enrollments table, for platform-enrolled patients)

### 2. Edge Function: `sync-credits`

Fetches deals from Zoho CRM Deals module where `Enrollment_Status = "Paid"` or stage is "Surgery Completed". For each deal, pulls:
- `Deal_Name`, `Stage`, `Surgery_Date`, `$750_Credit_Applies_Until` (mapped from your field `$750 Expiry Date`), `$500_Credit_Applies_Until`, `Owner`, surgeon lookup

Credit calculation logic:
- Stage = "Surgery Completed" AND Surgery_Date is not empty:
  - If Surgery_Date <= $750 expiry → credit = $750, status = `earned`
  - Else if Surgery_Date <= $500 expiry → credit = $500, status = `earned`
  - Else → credit = $0, status = `forfeited`
- Stage != "Surgery Completed" → status = `pending`, credit = potential max based on current date vs expiry windows

Upserts results into `surgeon_credits` table (dedup by `zoho_deal_id`). Does NOT overwrite records marked as `issued`.

### 3. Edge Function: `mark-credit-issued`

Allows admins to mark one or more credit records as "issued" (meaning the credit has been paid out to the surgeon). Updates `credit_status = 'issued'`, `issued_at`, `issued_by`.

### 4. Excel Import (One-Time)

A script or edge function to import the "Enrollments Data Captured" sheet. Maps columns:
- **Surgeon** → `surgeon_name` (matched to `surgeons` table)
- **Patient Name** → `patient_name`
- **Email** → `patient_email`
- **Enrollment PAID** → determines if the record qualifies
- **Surgery Date** → `surgery_date`
- **Enrollment Date** → `enrollment_date`
- **$750 Expiry Date** → `credit_750_expires`
- **$500 Expiry Date** → `credit_500_expires`
- **Surgery Credit Status** → maps to `credit_status`
- **Surgery Stage Status** → `stage`
- **Surgery Owner** → `consultant_email`
- `source = 'import'`

Records where "Enrollment PAID" is set get imported. Credit amount is calculated using the same logic as the Zoho sync.

### 5. Dashboard UI: Credits Tab

New tab in the admin dashboard: **"Credits"** with a dollar-sign icon.

**Top-level KPIs:**
- Total Credits Earned (not yet issued)
- Total Credits Issued (paid out)
- Total Pending (surgery not yet completed)
- Total Forfeited

**Per-Surgeon Accordion/Table:**
- Surgeon name, total earned, total issued, total pending, total forfeited
- Expandable to see individual patient records with: patient name, enrollment date, surgery date, credit amount, status
- "Mark as Issued" button on earned credits (single or bulk select)
- Filter by surgeon, by status, by date range

**Report Generation:**
- "Generate Report" button per surgeon → downloads a formatted summary (CSV or PDF) showing all enrollments, credit amounts, issued vs. outstanding

### 6. Dashboard Integration

Add the Credits tab to `AdminDashboard.tsx` alongside Patients, Transactions, etc. Add a "Sync Credits from CRM" button that calls the `sync-credits` edge function.

## Technical Details

- Database migration creates `surgeon_credits` table with RLS (admin-only access)
- `sync-credits` edge function uses existing Zoho OAuth pattern with pagination
- Excel import runs once via a script in the edge function or admin action
- `mark-credit-issued` validates admin auth, updates status, logs to `admin_audit_log`
- Credit reports use React Query to fetch from `surgeon_credits` table with surgeon joins
- CSV export handled client-side from the queried data

## Files to Create/Modify

| File | Action |
|------|--------|
| Migration SQL | Create `surgeon_credits` table + enum |
| `supabase/functions/sync-credits/index.ts` | New — Zoho deal fetch + credit calc |
| `supabase/functions/mark-credit-issued/index.ts` | New — mark credits as issued |
| `src/components/admin/CreditsTab.tsx` | New — credits management UI |
| `src/pages/AdminDashboard.tsx` | Add Credits tab |
| `supabase/config.toml` | Register new functions |
| Import script | One-time Excel data import into `surgeon_credits` |

