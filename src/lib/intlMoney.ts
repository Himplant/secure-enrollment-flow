/** Multi-currency helpers for the international module (US helpers untouched). */

const ZERO_DECIMAL = new Set(["CLP", "JPY", "KRW", "VND", "PYG"]);

export function decimalsFor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

export function fromMinor(amountMinor: number, currency: string): number {
  return amountMinor / Math.pow(10, decimalsFor(currency));
}

export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * Math.pow(10, decimalsFor(currency)));
}

export function formatIntlMoney(amountMinor: number, currency: string, locale?: string): string {
  const cur = (currency || "USD").toUpperCase();
  return new Intl.NumberFormat(locale ?? "en-US", {
    style: "currency",
    currency: cur,
    minimumFractionDigits: decimalsFor(cur),
    maximumFractionDigits: decimalsFor(cur),
  }).format(fromMinor(amountMinor, cur));
}

export const COUNTRY_LABEL: Record<string, string> = {
  MX: "Mexico",
  CO: "Colombia",
  CL: "Chile",
};
