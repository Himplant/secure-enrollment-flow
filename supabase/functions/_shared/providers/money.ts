// Multi-currency minor-unit helpers for the international module.
// Deliberately separate from the USD-only helpers used by the U.S. flow.

const ZERO_DECIMAL = new Set(["CLP", "JPY", "KRW", "VND", "PYG"]);

export function decimalsFor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * Math.pow(10, decimalsFor(currency)));
}

export function fromMinor(amountMinor: number, currency: string): number {
  return amountMinor / Math.pow(10, decimalsFor(currency));
}

export function formatMoney(amountMinor: number, currency: string, locale = "en-US"): string {
  const cur = currency.toUpperCase();
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: cur,
    minimumFractionDigits: decimalsFor(cur),
    maximumFractionDigits: decimalsFor(cur),
  }).format(fromMinor(amountMinor, cur));
}
