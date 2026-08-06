# Restore the US admin dashboard data

## What's actually happening

Nothing in the US code or data was deleted. Every US screen still exists, and the database still holds all 331 enrollments, 319 patients, 238 credits, 28 surgeons, 3 admins and your policy record.

The dashboard is blank because of a permissions gap introduced by the international migration. Confirmed from live requests: reads on `patients`, `surgeons` and `enrollments` are all returning

```text
403 — permission denied for function portal_scope_surgeon_ids
```

The international work added a read rule to the `surgeons` table for portal (surgeon/distributor) users. That rule calls three internal helper functions, and two of them were never given permission to run for logged-in users. Because every US query either reads surgeons or joins to it, the whole rule set errors out and the dashboard shows nothing — for admins too.

## The fix

One database change granting the missing execute permission on the three international helper functions, matching how the other helpers of the same family were already set up:

- `private.portal_scope_surgeon_ids(uuid)`
- `private.portal_surgeon_ids(uuid)`
- `private.has_portal_role(uuid, portal_role)`

Nothing in the US admin app, edge functions, or the international feature changes. No data is touched.

## Verification after the change

1. Query `surgeons`, `patients` and `enrollments` as a logged-in admin and confirm 200 responses with the expected row counts.
2. Reload `/admin` and confirm every tab renders data: Patients, Transactions, Policies, Surgeons, Credits, Credit Economics Dashboard, Audit Log, User Management.
3. Confirm analytics (stats, trend charts, surgeon and consultant distribution) populate again.
4. Confirm the International tabs and portal still work, so the new features stay intact.

## Audit of what the international work touched on the US side

For the record, the complete list of US-facing changes made during the international build — all additive, none reverted by this fix:

- `src/pages/AdminDashboard.tsx` — added the flag-gated International, International Setup and Feature Flags tabs. No existing tab removed.
- `supabase/functions/create-enrollment/index.ts` — surgeons pulled from Zoho now also store country/city, used by the international module.
- `supabase/functions/sync-surgeons/index.ts` — same country/city capture.
- `src/integrations/supabase/types.ts` — regenerated after the migration.
- Database: clinic/region tables (international only) dropped; portal read rules added to `surgeons`. This last item is the cause of the outage and is what the fix repairs.

If after the fix any specific US screen still looks different from before, name it and it gets restored exactly.
