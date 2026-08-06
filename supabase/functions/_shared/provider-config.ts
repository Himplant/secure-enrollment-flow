// Shared server helpers for the multi-provider payment foundation.
//
// Responsibilities kept here so every provider edge function behaves the same:
//   * actor resolution (Himplant super-admin OR surgeon_admin owning a surgeon)
//   * platform config load/validate/complete
//   * encrypted credential read/write through service-role RPCs
//   * callback / webhook / return URL construction
//   * audit logging that never contains a secret
//
// Nothing in this file is used by the U.S. SecurePay Stripe flow.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "./admin-auth.ts";
import { requirePortalUser } from "./portal-auth.ts";
import {
  buildCredentialMasks,
  decryptCredentials,
  encryptCredentials,
  MissingEncryptionKeyError,
} from "./provider-crypto.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export type SupportedProvider = "mercado_pago" | "paypal" | "stripe_connect" | "test";
export type ProviderEnvironment = "sandbox" | "live";

export const IMPLEMENTED_PROVIDERS: SupportedProvider[] = ["mercado_pago", "test"];

export function normalizeEnvironment(value: unknown): ProviderEnvironment {
  return value === "live" || value === "production" ? "live" : "sandbox";
}

// ---------------------------------------------------------------------------
// Actor resolution
// ---------------------------------------------------------------------------

export interface ProviderActor {
  kind: "admin" | "surgeon";
  userId: string;
  email: string | null;
  /** Surgeons this actor may act on. `null` = unrestricted (Himplant admin). */
  surgeonIds: string[] | null;
  supabaseAdmin: SupabaseClient;
}

export type ActorResult = { ok: true; actor: ProviderActor } | { ok: false; response: Response };

/**
 * Accepts either a Himplant admin (AAL2) or a portal surgeon_admin (AAL2).
 * `adminOnly` locks the endpoint to Himplant platform staff.
 */
export async function resolveProviderActor(
  req: Request,
  opts: { adminOnly?: boolean } = {},
): Promise<ActorResult> {
  const admin = await requireAdmin(req, { requireAal2: true });
  if (admin.ok) {
    return {
      ok: true,
      actor: {
        kind: "admin",
        userId: admin.userId,
        email: admin.email,
        surgeonIds: null,
        supabaseAdmin: admin.supabaseAdmin as unknown as SupabaseClient,
      },
    };
  }

  if (opts.adminOnly) return { ok: false, response: admin.response };

  const portal = await requirePortalUser(req, {
    anyRole: ["surgeon_admin"],
    requireAal2: true,
  });
  if (!portal.ok) return { ok: false, response: portal.response };

  const ownSurgeonIds = portal.memberships
    .filter((m) => m.role === "surgeon_admin" && m.org_type === "surgeon" && m.surgeon_id)
    .map((m) => m.surgeon_id as string);

  if (ownSurgeonIds.length === 0) {
    return { ok: false, response: json({ error: "No surgeon practice on this account" }, 403) };
  }

  return {
    ok: true,
    actor: {
      kind: "surgeon",
      userId: portal.userId,
      email: portal.email,
      surgeonIds: ownSurgeonIds,
      supabaseAdmin: portal.supabaseAdmin as unknown as SupabaseClient,
    },
  };
}

export function actorMayManageSurgeon(actor: ProviderActor, surgeonId: string): boolean {
  if (actor.surgeonIds === null) return true;
  return actor.surgeonIds.includes(surgeonId);
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

function functionsBase(): string {
  return `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1`;
}

export function appBase(): string {
  return (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
}

export function providerCallbackUrl(): string {
  return `${functionsBase()}/provider-connect-callback`;
}

export function providerWebhookUrl(provider: SupportedProvider): string {
  return `${functionsBase()}/intl-payment-webhook?provider=${provider}`;
}

export function providerReturnUrl(): string {
  return `${appBase()}/admin?tab=international&section=providers`;
}

// ---------------------------------------------------------------------------
// Platform configuration
// ---------------------------------------------------------------------------

export interface PlatformFieldSpec {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
}

export const PLATFORM_FIELDS: Record<string, PlatformFieldSpec[]> = {
  mercado_pago: [
    { key: "client_id", label: "Application ID / Client ID", required: true, secret: false },
    { key: "client_secret", label: "Client Secret", required: true, secret: true },
    { key: "public_key", label: "Public Key", required: false, secret: false },
    { key: "webhook_secret", label: "Webhook secret", required: true, secret: true },
  ],
  paypal: [
    { key: "client_id", label: "Client ID", required: true, secret: false },
    { key: "client_secret", label: "Client Secret", required: true, secret: true },
    { key: "webhook_id", label: "Webhook ID", required: true, secret: false },
  ],
  stripe_connect: [
    { key: "publishable_key", label: "Publishable key", required: true, secret: false },
    { key: "secret_key", label: "Secret key", required: true, secret: true },
    { key: "webhook_secret", label: "Webhook signing secret", required: true, secret: true },
  ],
};

export interface CompletenessResult {
  complete: boolean;
  missing: string[];
}

/** Validates a merged credential set against the provider's required fields. */
export function validatePlatformCompleteness(
  provider: string,
  values: Record<string, unknown>,
): CompletenessResult {
  const spec = PLATFORM_FIELDS[provider] ?? [];
  const missing = spec
    .filter((f) => f.required && !String(values[f.key] ?? "").trim())
    .map((f) => f.key);
  return { complete: missing.length === 0, missing };
}

export interface PlatformConfigRow {
  id: string;
  provider: string;
  environment: string;
  country: string | null;
  status: string;
  is_complete: boolean;
  missing_fields: string[];
  callback_url: string | null;
  webhook_url: string | null;
  return_url: string | null;
  credential_masks: Record<string, { present: boolean; mask: string | null }>;
  capabilities: Record<string, unknown>;
  last_verified_at: string | null;
  last_test_error: string | null;
}

export async function getPlatformConfig(
  db: SupabaseClient,
  provider: string,
  environment: ProviderEnvironment,
): Promise<PlatformConfigRow | null> {
  const { data } = await db
    .from("provider_platform_configs")
    .select("*")
    .eq("provider", provider)
    .eq("environment", environment)
    .is("country", null)
    .maybeSingle();
  return (data as PlatformConfigRow | null) ?? null;
}

export interface PlatformCredentials {
  client_id?: string;
  client_secret?: string;
  public_key?: string;
  webhook_secret?: string;
  [key: string]: unknown;
}

export async function loadPlatformCredentials(
  db: SupabaseClient,
  configId: string,
): Promise<PlatformCredentials | null> {
  const { data, error } = await db.rpc("read_provider_platform_credentials", {
    _config_id: configId,
  });
  if (error) throw new Error(`Unable to read platform credentials: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.encrypted_blob) return null;
  return (await decryptCredentials(row.encrypted_blob, row.iv)) as PlatformCredentials;
}

export async function savePlatformCredentials(
  db: SupabaseClient,
  configId: string,
  credentials: Record<string, unknown>,
): Promise<void> {
  const { blob, iv, version } = await encryptCredentials(credentials);
  const { error } = await db.rpc("store_provider_platform_credentials", {
    _config_id: configId,
    _blob: blob,
    _iv: iv,
    _version: version,
  });
  if (error) throw new Error(`Unable to store platform credentials: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Surgeon provider-account credentials
// ---------------------------------------------------------------------------

export interface AccountCredentials {
  access_token?: string;
  refresh_token?: string;
  public_key?: string;
  client_id?: string;
  client_secret?: string;
  webhook_secret?: string;
  [key: string]: unknown;
}

export async function loadAccountCredentials(
  db: SupabaseClient,
  accountId: string,
): Promise<{ credentials: AccountCredentials; expiresAt: string | null; scope: string | null } | null> {
  const { data, error } = await db.rpc("read_provider_account_credentials", {
    _account_id: accountId,
  });
  if (error) throw new Error(`Unable to read account credentials: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.encrypted_blob) return null;
  return {
    credentials: (await decryptCredentials(row.encrypted_blob, row.iv)) as AccountCredentials,
    expiresAt: row.expires_at ?? null,
    scope: row.scope ?? null,
  };
}

export async function saveAccountCredentials(
  db: SupabaseClient,
  accountId: string,
  credentials: AccountCredentials,
  meta: { expiresAt?: string | null; scope?: string | null; environment: ProviderEnvironment },
): Promise<void> {
  const { blob, iv, version } = await encryptCredentials(credentials);
  const { error } = await db.rpc("store_provider_account_credentials", {
    _account_id: accountId,
    _blob: blob,
    _iv: iv,
    _expires_at: meta.expiresAt ?? null,
    _scope: meta.scope ?? null,
    _environment: meta.environment,
    _version: version,
  });
  if (error) throw new Error(`Unable to store account credentials: ${error.message}`);
}

export function accountMasks(credentials: AccountCredentials) {
  return buildCredentialMasks({
    access_token: credentials.access_token as string | undefined,
    refresh_token: credentials.refresh_token as string | undefined,
    public_key: credentials.public_key as string | undefined,
    client_secret: credentials.client_secret as string | undefined,
    webhook_secret: credentials.webhook_secret as string | undefined,
  });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type ProviderAuditAction =
  | "configure"
  | "connect_start"
  | "connect"
  | "test"
  | "refresh"
  | "rotate"
  | "disconnect"
  | "set_active"
  | "manual_credentials"
  | "webhook";

export async function logProviderAudit(
  db: SupabaseClient,
  params: {
    provider: string;
    action: ProviderAuditAction;
    entityType: "platform_config" | "provider_account";
    entityId: string | null;
    actorId?: string | null;
    summary?: Record<string, unknown>;
    responseStatus?: number | null;
    error?: string | null;
  },
): Promise<void> {
  try {
    await db.from("integration_audit_logs").insert({
      integration: `provider:${params.provider}`,
      direction: "outbound",
      entity_type: params.entityType,
      entity_id: params.entityId,
      // Summaries are assembled by callers from metadata only — never secrets.
      request_summary: { action: params.action, ...(params.summary ?? {}) },
      response_status: params.responseStatus ?? null,
      error: params.error ?? null,
      attempt: 1,
      actor_id: params.actorId ?? null,
    });
  } catch {
    /* audit must never break the operation */
  }
}

export function encryptionKeyErrorResponse(err: unknown): Response | null {
  if (err instanceof MissingEncryptionKeyError) {
    return json(
      { error: "Provider credential encryption key is not configured. Add PROVIDER_CREDENTIALS_KEY in project secrets." },
      503,
    );
  }
  return null;
}
