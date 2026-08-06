// Maps Zoho Surgeons-module address fields to the international country codes
// used by the consultations module. Anything unrecognised stays domestic.
export type IntlCountry = "MX" | "CO" | "CL";

const NAME_TO_CODE: Record<string, IntlCountry> = {
  mexico: "MX",
  méxico: "MX",
  mexico city: "MX",
  mx: "MX",
  mex: "MX",
  colombia: "CO",
  co: "CO",
  col: "CO",
  chile: "CL",
  cl: "CL",
  chi: "CL",
};

export interface ZohoAddressLike {
  Country?: string | null;
  Mailing_Country?: string | null;
  Billing_Country?: string | null;
  Shipping_Country?: string | null;
  City?: string | null;
  Mailing_City?: string | null;
  Billing_City?: string | null;
  [key: string]: unknown;
}

export function rawCountry(s: ZohoAddressLike): string | null {
  return (
    s.Country ||
    s.Mailing_Country ||
    s.Billing_Country ||
    s.Shipping_Country ||
    null
  );
}

export function rawCity(s: ZohoAddressLike): string | null {
  return s.City || s.Mailing_City || s.Billing_City || null;
}

/** Returns "MX" | "CO" | "CL" for international surgeons, otherwise null. */
export function toIntlCountry(value: string | null | undefined): IntlCountry | null {
  if (!value) return null;
  const key = String(value).trim().toLowerCase();
  return NAME_TO_CODE[key] ?? null;
}

/** country / city / is_international columns for the surgeons table. */
export function surgeonLocationFields(s: ZohoAddressLike) {
  const raw = rawCountry(s);
  const code = toIntlCountry(raw);
  return {
    country: code ?? (raw ? String(raw).trim() : null),
    city: rawCity(s) ? String(rawCity(s)).trim() : null,
    is_international: code !== null,
  };
}
