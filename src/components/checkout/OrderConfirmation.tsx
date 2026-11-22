import { CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatNok } from '../../lib/format';
import type { Order, OrderPaymentStatus, PaymentProviderId } from '../../types/domain';

export interface OrderConfirmationProps {
  order: Order;
  providerDisplayName?: string;
}

const PROVIDER_LABELS: Record<PaymentProviderId, string> = {
  test_order: 'Testbestilling',
  klarna: 'Klarna',
  vipps: 'Vipps',
};

const PAYMENT_STATUS_LABELS: Record<OrderPaymentStatus, string> = {
  paid_test: 'Betalt (testordre)',
  pending_provider: 'Avventer betalingsleverandør (Testmodus)',
  authorized: 'Autorisert',
};

export function OrderConfirmation({ order, providerDisplayName }: OrderConfirmationProps) {
  const resolvedProviderName = providerDisplayName ?? PROVIDER_LABELS[order.paymentProvider];
  const resolvedPaymentStatus = PAYMENT_STATUS_LABELS[order.paymentStatus];

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-success/30 bg-ivory p-6 shadow-nordic sm:p-8"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-1 h-7 w-7 shrink-0 text-success" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">
              Ordrebekreftelse
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold text-espresso sm:text-4xl">
              Takk for din bestilling!
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-charcoal">
              Bestillingen din er registrert og bekreftet. Her finner du oppsummering av ordren.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-sand bg-canvas px-4 py-3">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-taupe">
              Ordrenummer
            </span>
            <p
              data-testid="order-number"
              className="mt-0.5 font-mono text-base font-semibold text-espresso"
            >
              {order.orderNumber}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <span className="text-xs font-medium uppercase tracking-wide text-taupe">Totalt</span>
            <p className="mt-0.5 text-base font-semibold text-espresso tabular-nums">
              {formatNok(order.totalNok)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-12">
        <section
          aria-labelledby="order-items-heading"
          className="rounded-xl border border-sand bg-ivory p-6 shadow-nordic lg:col-span-7"
        >
          <h2 id="order-items-heading" className="font-serif text-xl font-semibold text-espresso">
            Bestilte varer
          </h2>

          <ul className="mt-4 divide-y divide-sand">
            {order.items.map((item) => (
              <li key={item.productId} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-espresso">{item.title}</p>
                  <p className="mt-0.5 text-xs text-taupe tabular-nums">
                    {item.quantity} × {formatNok(item.unitPriceNok)}
                  </p>
                </div>
                <span className="text-sm font-semibold text-espresso tabular-nums">
                  {formatNok(item.lineTotalNok)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 space-y-2 border-t border-sand pt-4 text-sm">
            <div className="flex items-center justify-between text-charcoal">
              <dt>Delsum</dt>
              <dd className="tabular-nums">{formatNok(order.subtotalNok)}</dd>
            </div>
            <div className="flex items-center justify-between text-charcoal">
              <dt>Frakt</dt>
              <dd className="tabular-nums">
                {order.shippingNok === 0 ? 'Gratis frakt (0 kr)' : formatNok(order.shippingNok)}
              </dd>
            </div>
            <div className="flex items-center justify-between text-xs text-taupe">
              <dt>Herav mva (25 %)</dt>
              <dd className="tabular-nums">{formatNok(order.mvaNok)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-sand pt-2 text-base font-semibold text-espresso">
              <dt>Totalt</dt>
              <dd className="tabular-nums">{formatNok(order.totalNok)}</dd>
            </div>
          </dl>
        </section>

        <div className="space-y-6 lg:col-span-5">
          <section
            aria-labelledby="order-address-heading"
            className="rounded-xl border border-sand bg-ivory p-6 shadow-nordic"
          >
            <h2
              id="order-address-heading"
              className="font-serif text-xl font-semibold text-espresso"
            >
              Kunde- og leveringsadresse
            </h2>
            <div className="mt-3 space-y-1 text-sm text-charcoal">
              <p className="font-semibold text-espresso">{order.customer.name}</p>
              <p>{order.customer.email}</p>
              <p>{order.customer.phone}</p>
              <p className="pt-2">{order.shippingAddress.street}</p>
              <p>
                {order.shippingAddress.postalCode} {order.shippingAddress.city}
              </p>
            </div>
          </section>

          <section
            aria-labelledby="order-payment-heading"
            className="rounded-xl border border-sand bg-ivory p-6 shadow-nordic"
          >
            <h2
              id="order-payment-heading"
              className="font-serif text-xl font-semibold text-espresso"
            >
              Betaling
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-taupe">Leverandør</dt>
                <dd className="font-medium text-espresso">{resolvedProviderName}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-taupe">Betalingsstatus</dt>
                <dd className="font-medium text-espresso">{resolvedPaymentStatus}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-taupe">Betalingsreferanse</dt>
                <dd className="font-mono text-xs text-espresso">{order.paymentReference}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          to="/kategori/alle"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-bronze px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
        >
          Fortsett å handle
        </Link>
        <Link
          to="/"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-sand bg-canvas px-5 py-2.5 text-sm font-semibold text-espresso transition-colors hover:border-bronze hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
        >
          Tilbake til forsiden
        </Link>
      </div>
    </div>
  );
}
