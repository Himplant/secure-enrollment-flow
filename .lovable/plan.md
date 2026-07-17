## Goal

Give you a clear P&L view of the $500 deposit / $750 credit program: what you've collected, what you've already paid out to surgeons, what you still owe, what's at risk of becoming owed, and how much overpayment (the $250 gap on redeemed $750 credits) is eating into revenue.

## Placement

New tab **"Credit Economics"** in the Admin Dashboard, placed right after the existing **Credits** tab. Respects the existing top-of-page **date range**, **surgeon**, and **consultant** filters — same controls, same behavior.

## Metrics

All amounts in USD, sourced from `enrollments` (Stripe truth) and `surgeon_credits`.

**KPI cards (top row):**

| Card | Formula | Meaning |
|---|---|---|
| Collected | sum(amount_cents) where status='paid' − sum(amount_cents) where status='refunded' | Net cash in bank |
| Paid Out to Surgeons | sum(issued_amount) where credit_status='issued' | Already disbursed |
| Earned – Owed | sum(credit_amount) where credit_status='earned' | Owed now, not yet paid |
| Pending Liability | sum(credit_amount) where credit_status='pending' | Max we could owe if every in-window patient redeems |
| Overpayment (realized) | count of $750 credits where status in ('issued','earned') × $250 | Loss already booked on redeemed 3-month credits |
| Overpayment (potential) | count of $750 pending credits × $250 | Additional loss if every pending 3-month credit redeems |
| Forfeited (gain) | count of forfeited credits × $500 | Deposits kept with no payout |
| **Net Position** | Collected − Paid Out − Earned − Realized Overpayment + Forfeited | Current net economic result |

Formulas match the definitions you confirmed. Refunds are excluded from Collected (since the deposit was returned).

**Breakdown by surgeon (table + bar chart):**

Columns: Surgeon · # Enrolled · Collected · Paid Out · Earned (owed) · Pending Liability · Realized Overpayment · Potential Overpayment · Forfeited · **Net per Surgeon**

Sortable by any column. Bar chart shows Paid Out + Earned + Pending stacked per surgeon so you can see which surgeons drive the most liability.

**Filters applied:** date range filters on `enrollment_date` (credits) and `paid_at` (collections). Surgeon and consultant filters narrow both the KPIs and the table.

## Technical notes

- New file: `src/components/admin/CreditEconomicsTab.tsx`.
- New helper: `src/lib/creditEconomics.ts` with a pure `computeCreditEconomics(enrollments, credits)` function so it's easy to unit-test the formulas.
- Data fetched via existing `useQuery` patterns — one query for `enrollments` (already fetched at dashboard level, will reuse `rawPlatformEnrollments`), one new query for `surgeon_credits` joined with `surgeons(name)`. Both keyed to date range so React Query cache invalidates with the Refresh button that's already wired up.
- Wire the tab into `src/pages/AdminDashboard.tsx` (`TabsList` + `TabsContent`), passing the same filter state props already computed at the top (`dateRange`, `analyticsSurgeonFilter`, `analyticsConsultantFilter`).
- Charts use the same `recharts` setup already used by `SurgeonTrendChart` / `SurgeonDistributionCard` for visual consistency.
- No schema changes, no edge function changes, no changes to how credits are computed elsewhere.

## Out of scope (call out if you want them next)

- Month-over-month trend chart of these economics (you selected surgeon breakdown only; happy to add).
- Consultant breakdown table (same reason).
- CSV export of the surgeon economics table.
