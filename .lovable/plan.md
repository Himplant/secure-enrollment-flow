# Credit not earned for gonereturndepend@yahoo.com (Daniel Sanchez III)

## What we found
The credit record synced correctly: stage = "Surgery Completed", Dr. Farshad Shafizadeh, enrolled 2026-08-06, $750 window open until 2026-11-04.

But **surgery date is empty**. The Zoho Deal's "Active Surgery Date" field is blank. A credit only becomes "Earned" when the stage is Surgery Completed **and** a surgery date exists. That date decides $750 vs $500 vs forfeited. With no date, it stays "Pending".

## Fix for this patient (no code needed)
1. In Zoho, open the Deal (ID 2082094000417805874) and fill in **Active Surgery Date**.
2. Re-run the credit sync.
3. If the date is on or before 2026-11-04, the credit becomes **Earned, $750**.

## Optional change to prevent confusion
In the Credits tab, show a "Missing surgery date" warning on rows where the stage is Surgery Completed but the date is blank. Staff can then see right away why the credit hasn't moved. Earning rules stay the same, and no data changes.

## Technical details
- `calculateCredit` in `sync-credits` needs both `stage === "Surgery Completed"` and a `surgeryDate` before it returns earned.
- The optional change only touches the display in `CreditsTab.tsx`.
