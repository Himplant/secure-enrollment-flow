// Single-button Zoho router.
//
// Zoho keeps ONE "Generate Enrollment Link" button. This function:
//   1. authenticates the caller with the existing U.S. Zoho conventions
//      (x-shared-secret OR HMAC over `${timestamp}.${body}`),
//   2. refreshes the referenced surgeon from Zoho (authoritative country),
//   3. routes server-side by the FRESH country code — never by surgeon name:
//        MX / CO / CL -> intl-create-consultation-from-zoho
//        everything else -> create-enrollment (protected U.S. flow, untouched)
//   4. normalizes both responses so legacy Deluge parsing keeps working.
//
// Fails closed when the surgeon cannot be refreshed or is inactive.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { fetchAndUpsertSurgeonFromZoho } from "../_shared/intl-zoho.ts";
import {
  flowForCountry,
  normalizeError,
  normalizeResponse,
  sanitizeIntlPayload,
} from "../_shared/zoho-route.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shared-secret, x-hmac-signature, x-hmac-timestamp",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function header(headers: Headers, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [k, v] of headers.entries()) if (k.toLowerCase() === lower) return v;
  return null;
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const sharedSecret = Deno.env.get("ENROLLMENT_SHARED_SECRET");
    if (!sharedSecret) return json({ error: "ENROLLMENT_SHARED_SECRET is not configured" }, 500);

    const bodyText = await req.text();
    const headerSecret = header(req.headers, "x-shared-secret");
    const signature = header(req.headers, "x-hmac-signature");
    const timestamp = header(req.headers, "x-hmac-timestamp");

    let authenticated = false;
    if (headerSecret) {
      authenticated = timingSafeEqual(headerSecret, sharedSecret);
    } else if (signature && timestamp) {
      if (Date.now() - parseInt(timestamp, 10) > 300_000) {
        return json({ error: "Request timestamp expired" }, 401);
      }
      authenticated = timingSafeEqual(signature, await hmacSha256(`${timestamp}.${bodyText}`, sharedSecret));
    }
    if (!authenticated) return json({ error: "Unauthorized" }, 401);

    const body = JSON.parse(bodyText) as Record<string, unknown>;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // --- Resolve the Zoho surgeon id (never route on the surgeon display name) ---
    let zohoSurgeonId = body.zoho_surgeon_id
      ? String(body.zoho_surgeon_id)
      : body.surgeon_zoho_id
        ? String(body.surgeon_zoho_id)
        : null;

    if (!zohoSurgeonId && body.surgeon_id) {
      const { data: local } = await admin
        .from("surgeons")
        .select("zoho_id")
        .eq("id", String(body.surgeon_id))
        .maybeSingle();
      zohoSurgeonId = local?.zoho_id ? String(local.zoho_id) : null;
    }

    if (!zohoSurgeonId) {
      return json(normalizeError(null, null, null, "Surgeon could not be identified for routing"), 400);
    }

    // --- Refresh from Zoho BEFORE routing: CRM is authoritative ---
    const refreshed = await fetchAndUpsertSurgeonFromZoho(admin, zohoSurgeonId);
    if (!refreshed) {
      return json(normalizeError(null, null, null, "Surgeon could not be refreshed from Zoho"), 502);
    }

    const { data: surgeon } = await admin
      .from("surgeons")
      .select("id, country, is_active")
      .eq("id", refreshed.id)
      .maybeSingle();

    if (!surgeon) {
      return json(normalizeError(null, null, null, "Surgeon record unavailable after refresh"), 502);
    }
    if (surgeon.is_active === false) {
      return json(
        normalizeError(null, (surgeon.country as string | null) ?? null, null, "Surgeon is inactive"),
        409,
      );
    }

    const surgeonCountry = (surgeon.country as string | null) ?? null;
    const flowType = flowForCountry(surgeonCountry);

    // --- Route ---
    let targetPath: string;
    let outboundBody: Record<string, unknown>;
    const outboundHeaders: Record<string, string> = { "Content-Type": "application/json" };

    if (flowType === "international") {
      const intlSecret = Deno.env.get("INTL_ZOHO_SHARED_SECRET");
      if (!intlSecret) return json({ error: "INTL_ZOHO_SHARED_SECRET is not configured" }, 500);
      targetPath = "intl-create-consultation-from-zoho";
      // Legacy hardcoded `currency: "usd"` / `expires_in_hours` must never
      // reach the international service.
      outboundBody = sanitizeIntlPayload({ ...body, zoho_surgeon_id: zohoSurgeonId, surgeon_id: surgeon.id });
      outboundHeaders["x-intl-shared-secret"] = intlSecret;
    } else {
      targetPath = "create-enrollment";
      outboundBody = { ...body };
      outboundHeaders["x-shared-secret"] = sharedSecret;
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/${targetPath}`, {
      method: "POST",
      headers: outboundHeaders,
      body: JSON.stringify(outboundBody),
    });

    const text = await res.text();
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = null;
    }

    if (!res.ok || !payload || payload.success !== true) {
      console.error(`Downstream ${targetPath} failed with status ${res.status}`);
      return json(
        normalizeError(flowType, surgeonCountry, payload, `Downstream ${targetPath} error`),
        res.status >= 400 ? res.status : 502,
      );
    }

    return json(normalizeResponse(flowType, surgeonCountry, payload), 200);
  } catch (e) {
    console.error("zoho-generate-enrollment-link failed:", e instanceof Error ? e.message : "unknown");
    return json({ success: false, error: "Internal server error" }, 500);
  }
});
