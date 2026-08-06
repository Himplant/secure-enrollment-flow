// Shared international consultation creation service.
//
// Used by BOTH the Himplant admin dashboard endpoint
// (`intl-create-consultation`) and the Zoho endpoint
// (`intl-create-consultation-from-zoho`) so validation, policy resolution,
// duplicate handling, link minting and snapshots behave identically.

import { requireIntlEnabled } from "./flags.ts";
import { generateConsultationToken, hashConsultationToken, tokenLast4 } from "./intl-token.ts";
import { consultationLinkUrl, storeLinkToken } from "./intl-link-secret.ts";
import { createPolicySnapshot, resolveIntlPolicy } from "./intl-policy.ts";
import { fetchAndUpsertSurgeonFromZoho } from "./intl-zoho.ts";
import { linkExpiresAt } from "./intl-expiry.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface CreateConsultationInput {
  surgeonId?: string | null;
  zohoSurgeonId?: string | null;
  patientName: string;
  patientEmail?: string | null;
  patientPhone?: string | null;
  language?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  provider?: string | null;
  policyId?: string | null;
  notes?: string | null;
  expiresInHours?: number | null;
  zohoModule?: string | null;
  zohoRecordId?: string | null;
  agentEmail?: string | null;
  agentZohoId?: string | null;
  actorType: "admin" | "zoho";
  actorId?: string | null;
  actorEmail?: string | null;
}

export interface CreateConsultationSuccess {
  ok: true;
  consultationId: string;
  token: string;
  paymentUrl: string;
  expiresAt: string;
  tokenLast4: string;
  reused: boolean;
  surgeon: { id: string; name: string; country: string };
  policy: { id: string; version: string; rule: string };
  amountMinor: number;
  currency: string;
  provider: string;
  patientId: string;
  language: string;
}

export interface CreateConsultationFailure {
  ok: false;
  status: number;
  error: string;
}

export type CreateConsultationResult = CreateConsultationSuccess | CreateConsultationFailure;

const fail = (status: number, error: string): CreateConsultationFailure => ({ ok: false, status, error });

export async function createIntlConsultation(
  admin: Admin,
  input: CreateConsultationInput,
): Promise<CreateConsultationResult> {
  const patientName = (input.patientName ?? "").trim();
  if (!patientName) return fail(400, "patient_name is required");

  // ---- 1. Surgeon ----------------------------------------------------
  let surgeon: Record<string, unknown> | null = null;

  if (input.surgeonId) {
    const { data } = await admin.from("surgeons").select("*").eq("id", input.surgeonId).maybeSingle();
    surgeon = data ?? null;
  } else if (input.zohoSurgeonId) {
    const { data } = await admin.from("surgeons").select("*").eq("zoho_id", input.zohoSurgeonId).maybeSingle();
    surgeon = data ?? null;
    if (!surgeon) {
      const synced = await fetchAndUpsertSurgeonFromZoho(admin, input.zohoSurgeonId);
      if (synced) {
        const { data: fresh } = await admin.from("surgeons").select("*").eq("id", synced.id).maybeSingle();
        surgeon = fresh ?? null;
      }
    }
  }

  if (!surgeon) return fail(404, "Surgeon not found. Provide surgeon_id or a valid Zoho surgeon id.");
  if (!surgeon.is_active) return fail(409, "Surgeon is inactive");
  if (!surgeon.country) return fail(400, "This surgeon has no country set in Zoho");

  const country = String(surgeon.country);
  const surgeonId = String(surgeon.id);

  // ---- 2. Country settings -------------------------------------------
  const { data: settings } = await admin
    .from("international_country_settings")
    .select("*")
    .eq("country", country)
    .maybeSingle();

  if (!settings || !settings.is_enabled) {
    return fail(503, `Consultations are not enabled for ${country}`);
  }

  const currency = String(input.currency ?? surgeon.currency ?? settings.default_currency).toUpperCase();
  const language = String(input.language ?? settings.default_language ?? "es").toLowerCase();
  const amountMinor = Number(input.amountMinor ?? surgeon.consultation_fee_minor ?? 0);

  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    return fail(400, "A positive consultation amount is required");
  }
  if (amountMinor < Number(settings.min_fee_minor)) {
    return fail(400, "Amount is below the minimum consultation fee");
  }
  if (settings.max_fee_minor && amountMinor > Number(settings.max_fee_minor)) {
    return fail(400, "Amount is above the maximum consultation fee");
  }

  // ---- 3. Provider account -------------------------------------------
  const requested = input.provider ?? null;
  const allowed = (settings.allowed_providers ?? []) as string[];

  const { data: accounts } = await admin
    .from("provider_accounts")
    .select("id, provider, external_merchant_id, currency, status, is_active")
    .eq("surgeon_id", surgeonId)
    .eq("status", "connected")
    .eq("is_active", true);

  const account = (accounts ?? []).find(
    (a: Record<string, unknown>) =>
      allowed.includes(String(a.provider)) &&
      String(a.currency).toUpperCase() === currency &&
      (!requested || a.provider === requested) &&
      (requested || !surgeon!.active_provider || a.provider === surgeon!.active_provider),
  );

  if (!account) {
    return fail(409, "This surgeon has no connected payment account for the requested provider and currency");
  }

  const provider = String(account.provider);

  // ---- 4. Feature flags (server-side, fail closed) --------------------
  const flagBlock = await requireIntlEnabled({ country, provider });
  if (flagBlock) {
    const bodyText = await flagBlock.clone().text();
    let message = "This feature is not enabled";
    try {
      message = JSON.parse(bodyText).error ?? message;
    } catch { /* keep default */ }
    return fail(503, message);
  }

  // ---- 5. Policy (fail closed) ---------------------------------------
  const resolved = await resolveIntlPolicy(admin, {
    policyId: input.policyId ?? null,
    surgeonId,
    country,
    language,
    provider,
  });

  if (!resolved) {
    return fail(
      409,
      `No active policy found for ${country}/${language}/${provider}. Create a country-default or surgeon-specific policy first.`,
    );
  }

  // ---- 6. Patient (international patients never touch U.S. `patients`) -
  let patientId: string | null = null;
  const email = input.patientEmail?.trim().toLowerCase() || null;

  if (email) {
    const { data: existing } = await admin
      .from("consultation_patients")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    patientId = existing?.id ?? null;
  }

  if (patientId) {
    await admin
      .from("consultation_patients")
      .update({
        full_name: patientName,
        phone: input.patientPhone ?? undefined,
        country,
        preferred_language: language,
      })
      .eq("id", patientId);
  } else {
    const { data: created, error: patientErr } = await admin
      .from("consultation_patients")
      .insert({
        full_name: patientName,
        email,
        phone: input.patientPhone ?? null,
        country,
        preferred_language: language,
        notes: input.notes ?? null,
      })
      .select("id")
      .single();
    if (patientErr) return fail(400, patientErr.message);
    patientId = created.id as string;
  }

  // ---- 7. Duplicate prevention for Zoho-sourced invitations -----------
  let existingConsultation: Record<string, unknown> | null = null;
  if (input.zohoRecordId) {
    const { data } = await admin
      .from("consultations")
      .select("id, payment_status")
      .eq("zoho_record_id", input.zohoRecordId)
      .in("payment_status", ["draft", "link_created", "link_sent", "link_opened"])
      .maybeSingle();
    existingConsultation = data ?? null;
  }

  // ---- 8. Mint the link ----------------------------------------------
  const token = generateConsultationToken();
  const tokenHash = await hashConsultationToken(token);
  // Always exactly 48h — matches U.S. SecurePay. Callers cannot override it.
  const expiresAt = linkExpiresAt();

  const row = {
    token_hash: tokenHash,
    token_last4: tokenLast4(token),
    expires_at: expiresAt,
    surgeon_id: surgeonId,
    patient_id: patientId,
    agent_email: input.agentEmail ?? input.actorEmail ?? null,
    agent_zoho_id: input.agentZohoId ?? null,
    amount_minor: amountMinor,
    currency,
    country,
    provider,
    provider_account_id: account.id,
    recipient_external_merchant_id: account.external_merchant_id,
    payment_status: "link_created",
    consultation_status: "awaiting_payment",
    preferred_language: language,
    zoho_module: input.zohoModule ?? null,
    zoho_record_id: input.zohoRecordId ?? null,
    notes: input.notes ?? null,
    opened_at: null,
    sent_at: null,
    expired_at: null,
  };

  let consultationId: string;

  if (existingConsultation) {
    const { error } = await admin
      .from("consultations")
      .update(row)
      .eq("id", existingConsultation.id as string);
    if (error) return fail(400, error.message);
    consultationId = existingConsultation.id as string;
  } else {
    const { data: created, error } = await admin.from("consultations").insert(row).select("id").single();
    if (error) return fail(400, error.message);
    consultationId = created.id as string;
  }

  await storeLinkToken(admin, consultationId, token);

  await createPolicySnapshot(admin, {
    consultationId,
    resolved,
    surgeonId,
    country,
    language,
    provider,
    amountMinor,
    currency,
  });

  await admin.from("consultation_events").insert({
    consultation_id: consultationId,
    event_type: existingConsultation ? "consultation_link_replaced" : "consultation_created",
    event_data: {
      amount_minor: amountMinor,
      currency,
      provider,
      policy_rule: resolved.rule,
      source: input.actorType,
    },
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    actor_email: input.actorEmail ?? null,
  });

  return {
    ok: true,
    consultationId,
    token,
    paymentUrl: consultationLinkUrl(token),
    expiresAt,
    tokenLast4: tokenLast4(token),
    reused: !!existingConsultation,
    surgeon: { id: surgeonId, name: String(surgeon.name), country },
    policy: {
      id: String((resolved.policy as Record<string, unknown>).id),
      version: String((resolved.policy as Record<string, unknown>).version ?? "v1"),
      rule: resolved.rule,
    },
    amountMinor,
    currency,
    provider,
    patientId: patientId as string,
    language,
  };
}
