import type { IPaymentProvider } from '../../services/payments/types';
import type { PaymentProviderId } from '../../types/domain';

export interface PaymentSelectorProps {
  providers: readonly IPaymentProvider[];
  selectedProviderId: PaymentProviderId;
  onSelect: (providerId: PaymentProviderId) => void;
  disabled?: boolean;
  error?: string;
}

const DISPLAY_ORDER: Record<PaymentProviderId, number> = {
  vipps: 0,
  klarna: 1,
  test_order: 2,
};

function getProviderBadgeLabel(provider: IPaymentProvider): string {
  if (
    (provider.id === 'klarna' || provider.id === 'vipps') &&
    (provider.mode === 'sandbox' || !provider.isConfigured())
  ) {
    return 'Klargjort integrasjon (Testmodus)';
  }
  if (provider.id === 'test_order') {
    return 'Testmodus';
  }
  return 'Aktiv';
}

export function PaymentSelector({
  providers,
  selectedProviderId,
  onSelect,
  disabled = false,
  error,
}: PaymentSelectorProps) {
  const orderedProviders = [...providers].sort(
    (a, b) => (DISPLAY_ORDER[a.id] ?? 99) - (DISPLAY_ORDER[b.id] ?? 99),
  );

  return (
    <fieldset
      aria-describedby={error ? 'checkout-payment-error' : undefined}
      className="space-y-3"
    >
      <legend className="font-serif text-xl font-semibold text-espresso">Betalingsmåte</legend>

      <div role="radiogroup" aria-label="Velg betalingsmåte" className="mt-3 space-y-3">
        {orderedProviders.map((provider) => {
          const isSelected = provider.id === selectedProviderId;
          const badgeLabel = getProviderBadgeLabel(provider);
          const inputId = `payment-${provider.id}`;

          return (
            <label
              key={provider.id}
              htmlFor={inputId}
              className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                isSelected
                  ? 'border-bronze bg-linen'
                  : 'border-sand bg-canvas hover:border-bronze/60'
              } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
            >
              <input
                id={inputId}
                type="radio"
                name="paymentProvider"
                value={provider.id}
                checked={isSelected}
                onChange={() => onSelect(provider.id)}
                disabled={disabled}
                className="mt-1 h-4 w-4 shrink-0 accent-bronze"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-espresso">
                    {provider.displayName}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-sand bg-ivory px-2.5 py-0.5 text-[11px] font-medium text-taupe">
                    {badgeLabel}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-charcoal">
                  {provider.description}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      {error && (
        <p id="checkout-payment-error" role="alert" className="mt-1.5 text-xs font-medium text-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
