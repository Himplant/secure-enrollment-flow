import type { PaymentProvider } from "./types.ts";
import { testProvider } from "./test-provider.ts";

// Mercado Pago and PayPal adapters land in a later phase. Until then only the
// simulator is registered, so no code path can accidentally hit a live rail.
const REGISTRY: Record<string, PaymentProvider> = {
  test: testProvider,
};

export function getProvider(name: string): PaymentProvider | null {
  return REGISTRY[name] ?? null;
}

export function registeredProviders(): string[] {
  return Object.keys(REGISTRY);
}
