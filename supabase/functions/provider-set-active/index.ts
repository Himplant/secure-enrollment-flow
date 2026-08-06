// Make one connected provider account the surgeon's active payment rail.
// Only a verified, connected account can be activated.
import {
  actorMayManageSurgeon,
  corsHeaders,
  json,
  logProviderAudit,
  resolveProviderActor,
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
    .select("id, surgeon_id, provider, status")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return json({ error: "Provider account not found" }, 404);
  if (!actorMayManageSurgeon(actor, account.surgeon_id as string)) {
    return json({ error: "Surgeon is outside your scope" }, 403);
  }
  if (account.status !== "connected") {
    return json({ error: "Test the connection before making it active" }, 400);
  }

  const { error: deactivateErr } = await db
    .from("provider_accounts")
    .update({ is_active: false })
    .eq("surgeon_id", account.surgeon_id as string);
  if (deactivateErr) return json({ error: deactivateErr.message }, 400);

  const { error: activateErr } = await db
    .from("provider_accounts")
    .update({ is_active: true })
    .eq("id", accountId);
  if (activateErr) return json({ error: activateErr.message }, 400);

  const { error: surgeonErr } = await db
    .from("surgeons")
    .update({ active_provider: account.provider })
    .eq("id", account.surgeon_id as string);
  if (surgeonErr) return json({ error: surgeonErr.message }, 400);

  await logProviderAudit(db, {
    provider: String(account.provider),
    action: "set_active",
    entityType: "provider_account",
    entityId: accountId,
    actorId: actor.userId,
    summary: { surgeon_id: account.surgeon_id },
    responseStatus: 200,
  });

  return json({ ok: true });
});
