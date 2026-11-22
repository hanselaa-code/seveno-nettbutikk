import { Minus, Plus, ShoppingBag, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useOptionalCart } from '../../context/CartContext';
import type { ResolvedCartItem } from '../../context/CartContext';
import { useOptionalCatalog } from '../../context/CatalogContext';
import { FREE_SHIPPING_THRESHOLD_NOK, formatNok } from '../../lib/format';
import { DEFAULT_PRODUCT_IMAGE } from '../../types/domain';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface CartDrawerItemRowProps {
  item: ResolvedCartItem;
  catalogLoading: boolean;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onNavigate: () => void;
}

function CartDrawerItemRow({
  item,
  catalogLoading,
  onUpdateQuantity,
  onRemove,
  onNavigate,
}: CartDrawerItemRowProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [item.product?.imageUrl]);

  const title = item.product?.title ?? 'Utilgjengelig produkt';
  const imageSrc =
    imgError || !item.product?.imageUrl ? DEFAULT_PRODUCT_IMAGE : item.product.imageUrl;
  const maxReached = Boolean(item.product && item.quantity >= item.product.stock);
  const canIncrement = Boolean(
    item.product && item.product.active && item.quantity < item.product.stock,
  );

  return (
    <li className="flex gap-4 border-b border-sand py-4 last:border-b-0">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md border border-sand bg-ivory">
        <img
          src={imageSrc}
          alt={title}
          onError={() => {
            if (!imgError) {
              setImgError(true);
            }
          }}
          className="h-full w-full object-cover"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {item.product ? (
              <Link
                to={`/produkt/${item.product.slug}`}
                onClick={onNavigate}
                className="line-clamp-2 text-sm font-semibold text-espresso transition-colors hover:text-bronze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
              >
                {title}
              </Link>
            ) : (
              <p className="text-sm font-semibold text-espresso">{title}</p>
            )}
            <p className="mt-0.5 text-xs text-taupe tabular-nums">
              {item.product ? formatNok(item.unitPriceNok) : `ID: ${item.productId}`}
            </p>
            {!item.available && !catalogLoading && (
              <span className="mt-1 inline-block rounded bg-linen px-2 py-0.5 text-[11px] font-medium text-error">
                Ikke lenger tilgjengelig
              </span>
            )}
          </div>

          <span className="shrink-0 text-sm font-semibold text-espresso tabular-nums">
            {formatNok(item.lineTotalNok)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-md border border-sand bg-ivory">
              <button
                type="button"
                aria-label={`Reduser antall for ${title}`}
                onClick={() => onUpdateQuantity(item.productId, item.quantity - 1)}
                className="inline-flex h-9 w-9 items-center justify-center text-espresso transition-colors hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="min-w-8 text-center text-sm font-semibold text-espresso tabular-nums">
                {item.quantity}
              </span>
              <button
                type="button"
                aria-label={`Øk antall for ${title}`}
                disabled={!canIncrement}
                onClick={() => onUpdateQuantity(item.productId, item.quantity + 1)}
                className="inline-flex h-9 w-9 items-center justify-center text-espresso transition-colors hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            {maxReached && item.product && (
              <span className="text-xs text-taupe">
                Maks på lager ({item.product.stock} stk)
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => onRemove(item.productId)}
            className="text-xs font-medium text-error underline underline-offset-4 transition-colors hover:text-espresso focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
          >
            Fjern
          </button>
        </div>
      </div>
    </li>
  );
}

export function CartDrawer() {
  const cart = useOptionalCart();
  const catalog = useOptionalCatalog();
  const catalogLoading = catalog?.loading ?? false;

  const location = useLocation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const prevPathnameRef = useRef(location.pathname);

  const isDrawerOpen = cart?.isDrawerOpen ?? false;
  const closeDrawer = cart?.closeDrawer;

  useEffect(() => {
    if (prevPathnameRef.current !== location.pathname) {
      prevPathnameRef.current = location.pathname;
      if (isDrawerOpen && closeDrawer) {
        closeDrawer();
      }
    }
  }, [location.pathname, isDrawerOpen, closeDrawer]);

  useEffect(() => {
    if (!isDrawerOpen || !closeDrawer) {
      return;
    }

    const previousActiveElement =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow =
      typeof document !== 'undefined' ? document.body.style.overflow : '';

    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
    }

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
        return;
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => !el.hasAttribute('disabled'));

        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (event.shiftKey) {
          if (active === first || !dialogRef.current.contains(active)) {
            event.preventDefault();
            last.focus();
          }
        } else if (active === last || !dialogRef.current.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (typeof document !== 'undefined') {
        document.body.style.overflow = previousOverflow;
      }
      if (previousActiveElement && previousActiveElement.isConnected) {
        previousActiveElement.focus();
      }
    };
  }, [isDrawerOpen, closeDrawer]);

  if (!cart || !cart.isDrawerOpen) {
    return null;
  }

  const {
    resolvedItems,
    totalItems,
    subtotalNok,
    shippingNok,
    mvaNok,
    totalNok,
    updateQuantity,
    removeItem,
    clearCart,
  } = cart;

  const remainingForFreeShipping = Math.max(0, FREE_SHIPPING_THRESHOLD_NOK - subtotalNok);

  return (
    <div className="fixed inset-0 z-50">
      <div
        data-testid="cart-drawer-backdrop"
        className="fixed inset-0 bg-espresso/40"
        onClick={cart.closeDrawer}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        id="cart-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Handlekurv"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-sand bg-canvas shadow-nordic"
      >
        <div className="flex items-center justify-between border-b border-sand px-6 py-4">
          <div>
            <h2 className="font-serif text-2xl font-semibold text-espresso">Handlekurv</h2>
            <p className="text-xs text-taupe">
              {totalItems} {totalItems === 1 ? 'vare' : 'varer'}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={cart.closeDrawer}
            aria-label="Lukk handlekurv"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-sand bg-ivory text-espresso transition-colors hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {resolvedItems.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
            <ShoppingBag className="h-10 w-10 text-taupe" aria-hidden="true" />
            <p className="mt-4 font-serif text-xl font-semibold text-espresso">
              Din handlekurv er tom
            </p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-charcoal">
              Utforsk vårt utvalg av nordiske produkter til hjem, reise og uterom.
            </p>
            <Link
              to="/kategori/alle"
              onClick={cart.closeDrawer}
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md bg-bronze px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
            >
              Utforsk produkter
            </Link>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6">
              <ul>
                {resolvedItems.map((item) => (
                  <CartDrawerItemRow
                    key={item.productId}
                    item={item}
                    catalogLoading={catalogLoading}
                    onUpdateQuantity={updateQuantity}
                    onRemove={removeItem}
                    onNavigate={cart.closeDrawer}
                  />
                ))}
              </ul>
            </div>

            <div className="border-t border-sand bg-ivory px-6 py-5">
              {subtotalNok > 0 && remainingForFreeShipping > 0 && (
                <p className="mb-3 rounded-md border border-sand bg-linen px-3 py-2 text-xs text-espresso">
                  Handle for {formatNok(remainingForFreeShipping)} mer for gratis frakt
                </p>
              )}

              <dl className="space-y-1.5 text-sm">
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
                <div className="flex items-center justify-between border-t border-sand pt-2 text-base font-semibold text-espresso">
                  <dt>Totalt</dt>
                  <dd className="tabular-nums">{formatNok(totalNok)}</dd>
                </div>
                <div className="flex items-center justify-between text-xs text-taupe">
                  <dt>Inkl. mva.</dt>
                  <dd className="tabular-nums">{formatNok(mvaNok)}</dd>
                </div>
              </dl>

              <div className="mt-5 flex flex-col gap-2">
                <Link
                  to="/utsjekk"
                  onClick={cart.closeDrawer}
                  className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-bronze px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
                >
                  Gå til utsjekk
                </Link>
                <button
                  type="button"
                  onClick={clearCart}
                  className="inline-flex min-h-[40px] w-full items-center justify-center rounded-md border border-sand bg-canvas px-4 py-2 text-xs font-medium text-charcoal transition-colors hover:border-bronze hover:text-espresso focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
                >
                  Tøm handlekurv
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
