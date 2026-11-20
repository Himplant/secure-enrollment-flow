# Fix "Sync from CRM" failing past 2,000 Zoho deals

## What's wrong
Zoho is fine. The credit sync asks Zoho for deals one page at a time (page 1, 2, 3...). Zoho only allows the first 2,000 records to be fetched that way. Your Deals list has now grown past 2,000, so the sync stops with `DISCRETE_PAGINATION_LIMIT_EXCEEDED`.

## Fix
- Once past the first page, follow Zoho's "next page" marker instead of a page number. This works with any number of deals.
- Also keep only deals with Enrollment Status = Paid on our side. Today the code asks Zoho to do that filter, but that kind of request doesn't support filtering, so it has been pulling every deal.
- Keep the sync's other behavior exactly as it is: credit rules, owner updates, and skipping credits already issued.
- Put the fix live, then run the sync once and confirm it finishes.

## Technical details
- File: `supabase/functions/sync-credits/index.ts`, function `fetchDealsFromZoho`.
- First request: `GET /crm/v6/Deals?fields=...&per_page=200`. Next requests: add `page_token=<info.next_page_token>`. Loop while `info.more_records` is true and a token is returned. A 204 response ends the loop.
- After fetching, filter `deal.Enrollment_Status === "Paid"`. Drop the `criteria` param.
- Add a test that the loop follows `next_page_token` and never sends `page` above 10. Run the full vitest suite.
- Redeploy only `sync-credits`.
