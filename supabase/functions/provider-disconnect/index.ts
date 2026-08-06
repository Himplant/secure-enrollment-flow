// Disconnect a surgeon's provider account. Credentials are destroyed, the
// account is marked revoked, and it can no longer be used for checkout.
// Audit history is preserved.
import {
  actorMayManageSurgeon,
  corsHeaders,
  json,
  logProviderAudit,
  resolveProviderActor,
  saveAccountCredentials,
  normalizeEnvironment,
} from "../_shared/provider-config.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await resolveProviderActor(req);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const db = actor.supabaseAdmin;

  const body = await req.json().catch(() => ({}));
  const accountId = String(body.accountId ?? "");
  if (!accountId) return json({ error: "accountId is required" }, 400);

  const { data: account } = await db
    .from("provider_accounts")
    .select("id, surgeon_id, provider, environment")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return json({ error: "Provider account not found" }, 404);
  if (!actorMayManageSurgeon(actor, account.surgeon_id as string)) {
    return json({ error: "Surgeon is outside your scope" }, 403);
  }

  try {
    // Overwrite the encrypted blob with an empty credential set.
    await saveAccountCredentials(db, accountId, {}, {
      expiresAt: null,
      scope: null,
      environment: normalizeEnvironment(account.environment),
    });
  } catch (err) {
    console.error("provider-disconnect: credential wipe failed", (err as Error).message);
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("provider_accounts")
    .update({
      status: "revoked",
      is_active: false,
      credential_masks: {},
      scopes: null,
      token_expires_at: null,
      onboarding_status: "disconnected",
      connection_error: null,
      disconnected_at: now,
    })
    .eq("id", accountId);
  if (error) return json({ error: error.message }, 400);

  // Clear the surgeon's active rail if it pointed at this provider.
  const { data: stillActive } = await db
    .from("provider_accounts")
    .select("id")
    .eq("surgeon_id", account.surgeon_id as string)
    .eq("is_active", true)
    .maybeSingle();
  if (!stillActive) {
    await db.from("surgeons").update({ active_provider: null }).eq("id", account.surgeon_id as string);
  }

  await logProviderAudit(db, {
    provider: String(account.provider),
    action: "disconnect",
    entityType: "provider_account",
    entityId: accountId,
    actorId: actor.userId,
    summary: { surgeon_id: account.surgeon_id },
    responseStatus: 200,
  });

  return json({ ok: true });
});
