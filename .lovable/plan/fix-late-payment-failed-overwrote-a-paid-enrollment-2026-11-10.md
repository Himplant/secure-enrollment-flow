# Fix: late "payment failed" overwrote a paid enrollment

## What happened (confirmed from records)
Darren DeSantis' enrollment shows three checkout attempts on Nov 9:
- 17:37 first attempt (he closed it during the card verification code step)
- 17:40 second attempt
- 17:47 third attempt -> **paid at 17:50** (payment pi_...h6...)
- 17:54 Stripe sent a "payment failed" notice for the **first** abandoned attempt (pi_...ag...). Our system marked the whole enrollment Failed and pushed "Failed" to Zoho, even though he had already paid.

The payment is real; only the status is wrong.

## Fix
1. **Stop the overwrite:** when a "payment failed" notice arrives, ignore it if the enrollment is already Paid or Refunded, or if the failed payment is not the enrollment's current payment. Still log it in the history as "ignored stale failure", but don't change status or update Zoho.
2. **Same protection for "checkout expired"** notices (an old abandoned session expiring later must not override Paid).
3. **Repair Darren's record:** set status back to Paid (keep paid date 17:50, clear failed date), log a correction event, and push Enrollment_Status = Paid to his Zoho Deal with a note explaining the correction.
4. **Check for other affected patients:** look for any other enrollment that has a paid date but status Failed/Expired, and report them for the same repair (with your OK).

## Technical notes
- `stripe-webhook`: in `payment_intent.payment_failed` and `checkout.session.expired`, fetch `status, stripe_payment_intent_id, stripe_session_id` first; skip when status in (paid, refunded) or the event's id does not match the stored current id. Use a conditional update (`.not('status','in','(paid,refunded)')`) so a race can't overwrite either.
- Add regression test for stale failure after paid.
- This touches the U.S. payment notice handler (normally protected) — only the guard is added; paid flow unchanged.
