// Shared scheduler authentication for cron-invoked edge functions.
// Accepts either the legacy CRON_SECRET or the current SCHEDULER_SECRET.
export function isCronRequest(req: Request): boolean {
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!provided) return false;
  const candidates = [
    Deno.env.get("SCHEDULER_SECRET"),
    Deno.env.get("CRON_SECRET"),
  ].filter((v): v is string => !!v);
  return candidates.some((v) => v === provided);
}
