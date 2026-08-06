import type { PaymentProvider } from "./types.ts";
import { testProvider } from "./test-provider.ts";
import { mercadoPagoProvider } from "./mercado-pago.ts";
import { paypalProvider } from "./paypal.ts";

// Adapters are registered only once real code exists for them. Stripe Connect
// is deliberately absent until its adapter is written, so no code path can
// reach a half-built rail. Runtime feature flags still gate every provider.
const REGISTRY: Record<string, PaymentProvider> = {
  test: testProvider,
  mercado_pago: mercadoPagoProvider,
  paypal: paypalProvider,
};

export function getProvider(name: string): PaymentProvider | null {
  return REGISTRY[name] ?? null;
}

export function registeredProviders(): string[] {
  return Object.keys(REGISTRY);
}
