import type { PaymentProvider } from "./types.ts";
import { testProvider } from "./test-provider.ts";
import { mercadoPagoProvider } from "./mercado-pago.ts";
import { paypalProvider } from "./paypal.ts";
import { stripeConnectProvider } from "./stripe-connect.ts";

// Adapters are registered only once real code exists for them. Runtime feature
// flags still gate every provider, and `stripe_connect` here is the
// INTERNATIONAL Connect rail — it shares no code, keys or webhook endpoint
// with the U.S. SecurePay Stripe flow.
const REGISTRY: Record<string, PaymentProvider> = {
  test: testProvider,
  mercado_pago: mercadoPagoProvider,
  paypal: paypalProvider,
  stripe_connect: stripeConnectProvider,
};

export function getProvider(name: string): PaymentProvider | null {
  return REGISTRY[name] ?? null;
}

export function registeredProviders(): string[] {
  return Object.keys(REGISTRY);
}
