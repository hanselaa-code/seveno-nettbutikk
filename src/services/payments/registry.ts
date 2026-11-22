import type { PaymentProviderId } from '../../types/domain';
import { KlarnaPaymentAdapter } from './klarnaAdapter';
import type { KlarnaAdapterConfig } from './klarnaAdapter';
import { TestOrderAdapter } from './testOrderAdapter';
import type { TestOrderAdapterConfig } from './testOrderAdapter';
import { PaymentProviderError } from './types';
import type { IPaymentProvider } from './types';
import { VippsPaymentAdapter } from './vippsAdapter';
import type { VippsAdapterConfig } from './vippsAdapter';

export interface DefaultPaymentRegistryConfig {
  testOrder?: TestOrderAdapterConfig;
  klarna?: KlarnaAdapterConfig;
  vipps?: VippsAdapterConfig;
}

export class PaymentProviderRegistry {
  private readonly providers = new Map<PaymentProviderId, IPaymentProvider>();

  constructor(providers: ReadonlyArray<IPaymentProvider> = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: IPaymentProvider, options: { replace?: boolean } = {}): this {
    if (!options.replace && this.providers.has(provider.id)) {
      throw new PaymentProviderError(
        'registry',
        'DUPLICATE_PROVIDER',
        `Betalingsleverandør "${provider.id}" er allerede registrert.`,
      );
    }
    this.providers.set(provider.id, provider);
    return this;
  }

  has(id: string): boolean {
    return this.providers.has(id as PaymentProviderId);
  }

  find(id: string): IPaymentProvider | undefined {
    return this.providers.get(id as PaymentProviderId);
  }

  get(id: PaymentProviderId): IPaymentProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new PaymentProviderError(
        'registry',
        'PROVIDER_NOT_FOUND',
        `Betalingsleverandør "${id}" er ikke registrert.`,
      );
    }
    return provider;
  }

  list(): IPaymentProvider[] {
    return Array.from(this.providers.values());
  }

  listConfigured(): IPaymentProvider[] {
    return this.list().filter((p) => p.isConfigured());
  }

  getDefault(): IPaymentProvider {
    const fallback = this.find('test_order') ?? this.list()[0];
    if (!fallback) {
      throw new PaymentProviderError(
        'registry',
        'NO_PROVIDERS',
        'Ingen betalingsleverandører er registrert.',
      );
    }
    return fallback;
  }
}

export function createDefaultPaymentRegistry(
  config: DefaultPaymentRegistryConfig = {},
): PaymentProviderRegistry {
  return new PaymentProviderRegistry([
    new TestOrderAdapter(config.testOrder),
    new KlarnaPaymentAdapter(config.klarna),
    new VippsPaymentAdapter(config.vipps),
  ]);
}
