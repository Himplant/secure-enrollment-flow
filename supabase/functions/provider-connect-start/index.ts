// Begin an OAuth connection for a surgeon's Mercado Pago seller account.
// Generates a one-time, expiring `state` plus a PKCE verifier which is kept
// server-side only, and returns the provider authorization URL.
import {
  actorMayManageSurgeon,
  corsHeaders,
  encryptionKeyErrorResponse,
  getPlatformConfig,
  json,
  loadPlatformCredentials,
  logProviderAudit,
  normalizeEnvironment,
  providerCallbackUrl,
  providerReturnUrl,
  resolveProviderActor,
} from "../_shared/provider-config.ts";
import {
  codeChallengeS256,
  generateCodeVerifier,
  generateOAuthState,
} from "../_shared/provider-crypto.ts";
import { mpAuthorizationUrl } from "../_shared/providers/mercado-pago.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await resolveProviderActor(req);
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const db = actor.supabaseAdmin;

  try {
    const body = await req.json().catch(() => ({}));
    const provider = String(body.provider ?? "mercado_pago");
    if (provider !== "mercado_pago") return json({ error: "Unsupported provider" }, 400);

    const surgeonId = String(body.surgeonId ?? "");
    if (!surgeonId) return json({ error: "surgeonId is required" }, 400);
    if (!actorMayManageSurgeon(actor, surgeonId)) {
      return json({ error: "Surgeon is outside your scope" }, 403);
    }

    const environment = normalizeEnvironment(body.environment);
    const config = await getPlatformConfig(db, provider, environment);
    if (!config || !config.is_complete) {
      return json({ error: "Mercado Pago platform configuration is incomplete" }, 400);
    }
    const platform = await loadPlatformCredentials(db, config.id);
    if (!platform?.client_id) return json({ error: "Platform Application ID missing" }, 400);

    const state = generateOAuthState();
    const usePkce = body.usePkce !== false;
    const verifier = usePkce ? generateCodeVerifier() : null;
    const challenge = verifier ? await codeChallengeS256(verifier) : undefined;

    const { error: stateErr } = await db.rpc("create_provider_oauth_state", {
      _state: state,
      _provider: provider,
      _environment: environment,
      _surgeon_id: surgeonId,
      _platform_config_id: config.id,
      _code_verifier: verifier,
      _redirect_after: String(body.redirectAfter ?? providerReturnUrl()),
      _created_by: actor.userId,
      _created_by_email: actor.email,
      _ttl_seconds: 600,
    });
    if (stateErr) return json({ error: stateErr.message }, 500);

    const url = mpAuthorizationUrl({
      clientId: platform.client_id,
      redirectUri: config.callback_url ?? providerCallbackUrl(),
      state,
      codeChallenge: challenge,
    });

    await logProviderAudit(db, {
      provider,
      action: "connect_start",
      entityType: "provider_account",
      entityId: null,
      actorId: actor.userId,
      summary: { surgeon_id: surgeonId, environment, pkce: !!verifier },
      responseStatus: 200,
    });

    return json({ url, expiresInSeconds: 600 });
  } catch (err) {
    const keyErr = encryptionKeyErrorResponse(err);
    if (keyErr) return keyErr;
    console.error("provider-connect-start failed", (err as Error).message);
    return json({ error: (err as Error).message }, 500);
  }
});
