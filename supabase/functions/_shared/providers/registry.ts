import type { PaymentProvider } from "./types.ts";
import { testProvider } from "./test-provider.ts";
import { mercadoPagoProvider } from "./mercado-pago.ts";

// Adapters are registered only once real code exists for them. PayPal and
// Stripe Connect are deliberately absent until their adapters are written, so
// no code path can reach a half-built rail.
const REGISTRY: Record<string, PaymentProvider> = {
  test: testProvider,
  mercado_pago: mercadoPagoProvider,
};

export function getProvider(name: string): PaymentProvider | null {
  return REGISTRY[name] ?? null;
}

export function registeredProviders(): string[] {
  return Object.keys(REGISTRY);
}
