/** True when a payment_failed event must NOT change the enrollment status. */
export function isStaleFailure(
  currentStatus: string | null,
  currentPaymentIntentId: string | null,
  eventPaymentIntentId: string,
): boolean {
  if (currentStatus === "paid" || currentStatus === "refunded") return true;
  if (currentPaymentIntentId && currentPaymentIntentId !== eventPaymentIntentId) return true;
  return false;
}
