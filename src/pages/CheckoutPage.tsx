import { ShoppingBag } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { OrderConfirmation } from '../components/checkout/OrderConfirmation';
import { PaymentSelector } from '../components/checkout/PaymentSelector';
import { useOptionalCart } from '../context/CartContext';
import { useOptionalCatalog } from '../context/CatalogContext';
import { FREE_SHIPPING_THRESHOLD_NOK, formatNok } from '../lib/format';
import { VALIDATION_LIMITS, ValidationError, validateOrderInput } from '../lib/validators';
import { getOrderRepository, resolveCheckoutOwnerUid } from '../repositories/orderRepository';
import type { IOrderRepository } from '../repositories/orderRepository';
import { createDefaultPaymentRegistry } from '../services/payments/registry';
import type { PaymentProviderRegistry } from '../services/payments/registry';
import type { Order, PaymentProviderId } from '../types/domain';

export interface CheckoutPageProps {
  orderRepo?: IOrderRepository;
  paymentRegistry?: PaymentProviderRegistry;
  resolveOwnerUid?: () => Promise<string>;
}

export function CheckoutPage({
  orderRepo,
  paymentRegistry,
  resolveOwnerUid,
}: CheckoutPageProps) {
  const optionalCart = useOptionalCart();
  const optionalCatalog = useOptionalCatalog();
  const catalogLoading = optionalCatalog?.loading ?? false;

  const cartItems = useMemo(() => optionalCart?.items ?? [], [optionalCart?.items]);
  const resolvedItems = useMemo(
    () => optionalCart?.resolvedItems ?? [],
    [optionalCart?.resolvedItems],
  );
  const subtotalNok = optionalCart?.subtotalNok ?? 0;
  const shippingNok = optionalCart?.shippingNok ?? 0;
  const mvaNok = optionalCart?.mvaNok ?? 0;
  const totalNok = optionalCart?.totalNok ?? 0;

  const registry = useMemo(
    () => paymentRegistry ?? createDefaultPaymentRegistry(),
    [paymentRegistry],
  );
  const providers = useMemo(() => registry.list(), [registry]);

  const defaultProviderId: PaymentProviderId = registry.has('test_order')
    ? 'test_order'
    : (providers[0]?.id ?? 'test_order');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [selectedProviderId, setSelectedProviderId] =
    useState<PaymentProviderId>(defaultProviderId);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);

  const submittingRef = useRef(false);

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  if (completedOrder) {
    const providerDisplayName = registry.find(completedOrder.paymentProvider)?.displayName;
    return (
      <OrderConfirmation order={completedOrder} providerDisplayName={providerDisplayName} />
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-sand bg-ivory p-8 shadow-nordic sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">
            Handlekurv &amp; Betaling
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold text-espresso sm:text-4xl">
            Utsjekk
          </h1>

          <div className="mt-6 flex flex-col items-start gap-3 rounded-lg border border-sand bg-canvas p-6">
            <ShoppingBag className="h-8 w-8 text-taupe" aria-hidden="true" />
            <p className="font-serif text-xl font-semibold text-espresso">
              Handlekurven din er tom
            </p>
            <p className="text-sm leading-relaxed text-charcoal">
              Legg til produkter i handlekurven før du går videre til utsjekk og betaling.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/kategori/alle"
              className="inline-flex min-h-[44px] items-center rounded-md bg-bronze px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
            >
              Se alle produkter
            </Link>
            <Link
              to="/"
              className="inline-flex min-h-[44px] items-center rounded-md border border-sand bg-canvas px-5 py-2.5 text-sm font-semibold text-espresso transition-colors hover:border-bronze hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
            >
              Tilbake til forsiden
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    setSubmitError(null);

    const validation = validateOrderInput({
      ownerUid: 'pending-owner-uid',
      customer: { name, email, phone },
      shippingAddress: { street, postalCode, city },
      items: cartItems,
      paymentProvider: selectedProviderId,
    });

    if (!validation.valid || !validation.value) {
      setFieldErrors(validation.errors);
      if (validation.errors.items) {
        setSubmitError(validation.errors.items);
      }
      return;
    }

    setFieldErrors({});
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const provider = registry.get(selectedProviderId);

      if (catalogLoading) {
        throw new ValidationError(
          'Produktkatalogen lastes fortsatt inn.',
          {
            items: 'Produktkatalogen lastes fortsatt inn. Vent et øyeblikk og prøv igjen.',
          },
        );
      }

      const unavailable = resolvedItems.find((item) => !item.available);
      if (unavailable) {
        throw new ValidationError(
          `Produktet "${unavailable.productId}" er ikke tilgjengelig.`,
          {
            items: `Produktet "${unavailable.product?.title ?? unavailable.productId}" er ikke lenger tilgjengelig.`,
          },
        );
      }

      const overStock = resolvedItems.find((item) => item.exceedsStock);
      if (overStock && overStock.product) {
        throw new ValidationError(
          `Utilstrekkelig lagerbeholdning for "${overStock.product.title}".`,
          {
            items: `Bare ${overStock.product.stock} stk på lager for "${overStock.product.title}". Juster antallet før du fullfører bestillingen.`,
          },
        );
      }

      const sessionItems = resolvedItems.map((item) => {
        if (!item.product || item.unitPriceNok <= 0) {
          throw new ValidationError(
            `Produktet "${item.productId}" er ikke tilgjengelig.`,
            {
              items: `Produktet "${item.product?.title ?? item.productId}" er ikke lenger tilgjengelig.`,
            },
          );
        }
        return {
          productId: item.product.id,
          title: item.product.title,
          quantity: item.quantity,
          unitPriceNok: item.unitPriceNok,
        };
      });

      const ownerUid = await (resolveOwnerUid ?? resolveCheckoutOwnerUid)();
      const resolvedOrderRepo = orderRepo ?? getOrderRepository();

      const session = await provider.createSession({
        items: sessionItems,
        customer: validation.value.customer,
        shippingAddress: validation.value.shippingAddress,
      });

      const authResult = await provider.authorizePayment(session.sessionId);
      const paymentReference = authResult.reference || session.reference;
      const createPaymentStatus: 'paid_test' | 'pending_provider' =
        selectedProviderId === 'test_order' && authResult.orderPaymentStatus === 'paid_test'
          ? 'paid_test'
          : 'pending_provider';

      const order = await resolvedOrderRepo.create({
        ownerUid,
        customer: validation.value.customer,
        shippingAddress: validation.value.shippingAddress,
        items: cartItems,
        paymentProvider: selectedProviderId,
        paymentReference,
        paymentStatus: createPaymentStatus,
      });

      setCompletedOrder(order);
      optionalCart?.clearCart();
    } catch (error) {
      if (error instanceof ValidationError) {
        setFieldErrors(error.errors);
        if (
          error.errors.items ||
          error.errors.ownerUid ||
          Object.keys(error.errors).length === 0
        ) {
          setSubmitError(error.errors.items || error.errors.ownerUid || error.message);
        }
      } else {
        setSubmitError(
          error instanceof Error && error.message
            ? error.message
            : 'Vi klarte ikke å fullføre bestillingen akkurat nå. Vennligst prøv igjen.',
        );
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const inputBaseClass =
    'mt-1.5 w-full rounded-md border bg-canvas px-3.5 py-2.5 text-sm text-espresso placeholder:text-taupe/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze';

  const remainingForFreeShipping = Math.max(0, FREE_SHIPPING_THRESHOLD_NOK - subtotalNok);
  const exceedsMaxOrderItems = cartItems.length > VALIDATION_LIMITS.orderItemsMax;
  const isResolvingCatalogItems =
    catalogLoading && resolvedItems.some((item) => !item.product);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">
          Handlekurv &amp; Betaling
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-espresso sm:text-4xl">
          Utsjekk
        </h1>
      </div>

      <div className="grid gap-8 lg:grid-cols-12">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-8 rounded-xl border border-sand bg-ivory p-6 shadow-nordic sm:p-8 lg:col-span-7"
        >
          <section aria-labelledby="checkout-customer-heading" className="space-y-5">
            <h2
              id="checkout-customer-heading"
              className="font-serif text-xl font-semibold text-espresso"
            >
              Kundeinformasjon
            </h2>

            <div>
              <label htmlFor="checkout-name" className="block text-sm font-medium text-espresso">
                Fullt navn
              </label>
              <input
                id="checkout-name"
                name="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearFieldError('customer.name');
                }}
                aria-invalid={Boolean(fieldErrors['customer.name'])}
                aria-describedby={fieldErrors['customer.name'] ? 'checkout-name-error' : undefined}
                placeholder="Ola Nordmann"
                className={`${inputBaseClass} ${
                  fieldErrors['customer.name'] ? 'border-error' : 'border-sand'
                }`}
              />
              {fieldErrors['customer.name'] && (
                <p
                  id="checkout-name-error"
                  role="alert"
                  className="mt-1.5 text-xs font-medium text-error"
                >
                  {fieldErrors['customer.name']}
                </p>
              )}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="checkout-email" className="block text-sm font-medium text-espresso">
                  E-postadresse
                </label>
                <input
                  id="checkout-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFieldError('customer.email');
                  }}
                  aria-invalid={Boolean(fieldErrors['customer.email'])}
                  aria-describedby={
                    fieldErrors['customer.email'] ? 'checkout-email-error' : undefined
                  }
                  placeholder="ola@eksempel.no"
                  className={`${inputBaseClass} ${
                    fieldErrors['customer.email'] ? 'border-error' : 'border-sand'
                  }`}
                />
                {fieldErrors['customer.email'] && (
                  <p
                    id="checkout-email-error"
                    role="alert"
                    className="mt-1.5 text-xs font-medium text-error"
                  >
                    {fieldErrors['customer.email']}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="checkout-phone" className="block text-sm font-medium text-espresso">
                  Telefon
                </label>
                <input
                  id="checkout-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    clearFieldError('customer.phone');
                  }}
                  aria-invalid={Boolean(fieldErrors['customer.phone'])}
                  aria-describedby={
                    fieldErrors['customer.phone'] ? 'checkout-phone-error' : undefined
                  }
                  placeholder="91234567"
                  className={`${inputBaseClass} ${
                    fieldErrors['customer.phone'] ? 'border-error' : 'border-sand'
                  }`}
                />
                {fieldErrors['customer.phone'] && (
                  <p
                    id="checkout-phone-error"
                    role="alert"
                    className="mt-1.5 text-xs font-medium text-error"
                  >
                    {fieldErrors['customer.phone']}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section
            aria-labelledby="checkout-shipping-heading"
            className="space-y-5 border-t border-sand pt-6"
          >
            <h2
              id="checkout-shipping-heading"
              className="font-serif text-xl font-semibold text-espresso"
            >
              Leveringsadresse
            </h2>

            <div>
              <label htmlFor="checkout-street" className="block text-sm font-medium text-espresso">
                Gateadresse
              </label>
              <input
                id="checkout-street"
                name="street"
                type="text"
                autoComplete="street-address"
                value={street}
                onChange={(e) => {
                  setStreet(e.target.value);
                  clearFieldError('shippingAddress.street');
                }}
                aria-invalid={Boolean(fieldErrors['shippingAddress.street'])}
                aria-describedby={
                  fieldErrors['shippingAddress.street'] ? 'checkout-street-error' : undefined
                }
                placeholder="Storgata 10"
                className={`${inputBaseClass} ${
                  fieldErrors['shippingAddress.street'] ? 'border-error' : 'border-sand'
                }`}
              />
              {fieldErrors['shippingAddress.street'] && (
                <p
                  id="checkout-street-error"
                  role="alert"
                  className="mt-1.5 text-xs font-medium text-error"
                >
                  {fieldErrors['shippingAddress.street']}
                </p>
              )}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="checkout-postal-code"
                  className="block text-sm font-medium text-espresso"
                >
                  Postnummer (4 siffer)
                </label>
                <input
                  id="checkout-postal-code"
                  name="postalCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  value={postalCode}
                  onChange={(e) => {
                    setPostalCode(e.target.value);
                    clearFieldError('shippingAddress.postalCode');
                  }}
                  aria-invalid={Boolean(fieldErrors['shippingAddress.postalCode'])}
                  aria-describedby={
                    fieldErrors['shippingAddress.postalCode']
                      ? 'checkout-postal-code-error'
                      : undefined
                  }
                  placeholder="0155"
                  className={`${inputBaseClass} ${
                    fieldErrors['shippingAddress.postalCode'] ? 'border-error' : 'border-sand'
                  }`}
                />
                {fieldErrors['shippingAddress.postalCode'] && (
                  <p
                    id="checkout-postal-code-error"
                    role="alert"
                    className="mt-1.5 text-xs font-medium text-error"
                  >
                    {fieldErrors['shippingAddress.postalCode']}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="checkout-city" className="block text-sm font-medium text-espresso">
                  Poststed
                </label>
                <input
                  id="checkout-city"
                  name="city"
                  type="text"
                  autoComplete="address-level2"
                  value={city}
                  onChange={(e) => {
                    setCity(e.target.value);
                    clearFieldError('shippingAddress.city');
                  }}
                  aria-invalid={Boolean(fieldErrors['shippingAddress.city'])}
                  aria-describedby={
                    fieldErrors['shippingAddress.city'] ? 'checkout-city-error' : undefined
                  }
                  placeholder="Oslo"
                  className={`${inputBaseClass} ${
                    fieldErrors['shippingAddress.city'] ? 'border-error' : 'border-sand'
                  }`}
                />
                {fieldErrors['shippingAddress.city'] && (
                  <p
                    id="checkout-city-error"
                    role="alert"
                    className="mt-1.5 text-xs font-medium text-error"
                  >
                    {fieldErrors['shippingAddress.city']}
                  </p>
                )}
              </div>
            </div>
          </section>

          <div className="border-t border-sand pt-6">
            <PaymentSelector
              providers={providers}
              selectedProviderId={selectedProviderId}
              onSelect={(id) => {
                setSelectedProviderId(id);
                clearFieldError('paymentProvider');
              }}
              disabled={submitting}
              error={fieldErrors.paymentProvider}
            />
          </div>

          {submitError && (
            <div
              role="alert"
              className="rounded-md border border-error/30 bg-canvas px-4 py-3 text-sm font-medium text-error"
            >
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || catalogLoading}
            aria-busy={submitting || catalogLoading}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-bronze px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting
              ? 'Fullfører bestilling ...'
              : catalogLoading
                ? 'Laster produktkatalog ...'
                : 'Fullfør testbestilling'}
          </button>
        </form>

        <aside
          aria-labelledby="checkout-summary-heading"
          className="h-fit rounded-xl border border-sand bg-ivory p-6 shadow-nordic sm:p-8 lg:col-span-5"
        >
          <h2
            id="checkout-summary-heading"
            className="font-serif text-xl font-semibold text-espresso"
          >
            Ordresammendrag
          </h2>

          {isResolvingCatalogItems ? (
            <div
              role="status"
              aria-live="polite"
              className="mt-4 rounded-lg border border-sand bg-canvas p-4 text-sm text-taupe"
            >
              Laster ordresammendrag ...
            </div>
          ) : (
            <>
              {exceedsMaxOrderItems && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-error/30 bg-canvas px-3 py-2 text-xs font-medium text-error"
                >
                  Maks {VALIDATION_LIMITS.orderItemsMax} ulike produkter kan bestilles samtidig.
                  Fjern {cartItems.length - VALIDATION_LIMITS.orderItemsMax} produkt(er) før betaling.
                </div>
              )}
              <ul className="mt-4 divide-y divide-sand">
                {resolvedItems.map((item) => {
                  const title = item.product?.title ?? `Produkt (${item.productId})`;
                  return (
                    <li
                      key={item.productId}
                      className="flex items-start justify-between gap-3 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="wrap-anywhere font-medium text-espresso">{title}</p>
                        <p className="mt-0.5 text-xs text-taupe tabular-nums">
                          {item.quantity} × {formatNok(item.unitPriceNok)}
                        </p>
                        {!item.available && !catalogLoading && (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-error">
                              Ikke lenger tilgjengelig
                            </span>
                            {optionalCart && (
                              <button
                                type="button"
                                onClick={() => optionalCart.removeItem(item.productId)}
                                className="text-xs font-medium text-error underline underline-offset-4 hover:text-espresso"
                              >
                                Fjern
                              </button>
                            )}
                          </div>
                        )}
                        {item.exceedsStock && !catalogLoading && item.product && (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-error">
                              Bare {item.product.stock} stk på lager
                            </span>
                            {optionalCart && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    optionalCart.updateQuantity(
                                      item.productId,
                                      item.product!.stock,
                                    )
                                  }
                                  className="text-xs font-medium text-bronze underline underline-offset-4 hover:text-espresso"
                                >
                                  Juster til maks ({item.product.stock})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => optionalCart.removeItem(item.productId)}
                                  className="text-xs font-medium text-error underline underline-offset-4 hover:text-espresso"
                                >
                                  Fjern
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {exceedsMaxOrderItems && item.available && !item.exceedsStock && optionalCart && (
                          <div className="mt-1">
                            <button
                              type="button"
                              onClick={() => optionalCart.removeItem(item.productId)}
                              className="text-xs font-medium text-error underline underline-offset-4 hover:text-espresso"
                            >
                              Fjern
                            </button>
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 font-semibold text-espresso tabular-nums">
                        {formatNok(item.lineTotalNok)}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {subtotalNok > 0 && remainingForFreeShipping > 0 && (
                <p className="mt-4 rounded-md border border-sand bg-linen px-3 py-2 text-xs text-espresso">
                  Handle for {formatNok(remainingForFreeShipping)} mer for gratis frakt
                </p>
              )}

              <dl className="mt-4 space-y-2 border-t border-sand pt-4 text-sm">
                <div className="flex items-center justify-between text-charcoal">
                  <dt>Delsum</dt>
                  <dd className="tabular-nums">{formatNok(subtotalNok)}</dd>
                </div>
                <div className="flex items-center justify-between text-charcoal">
                  <dt>Frakt</dt>
                  <dd className="tabular-nums">
                    {shippingNok === 0 ? 'Gratis frakt' : formatNok(shippingNok)}
                  </dd>
                </div>
                <div className="flex items-center justify-between text-xs text-taupe">
                  <dt>Herav mva (25 %)</dt>
                  <dd className="tabular-nums">{formatNok(mvaNok)}</dd>
                </div>
                <div className="flex items-center justify-between border-t border-sand pt-2 text-base font-semibold text-espresso">
                  <dt>Totalt</dt>
                  <dd className="tabular-nums">{formatNok(totalNok)}</dd>
                </div>
              </dl>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
