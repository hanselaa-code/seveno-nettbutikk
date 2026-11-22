import { ArrowLeft, CheckCircle2, Minus, Plus, ShoppingBag, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useOptionalCart } from '../context/CartContext';
import { useCatalog } from '../context/CatalogContext';
import { FREE_SHIPPING_THRESHOLD_NOK, formatNok } from '../lib/format';
import { DEFAULT_PRODUCT_IMAGE } from '../types/domain';
import type { Product } from '../types/domain';

export function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const { loading: catalogLoading, getProductByIdOrSlug, resolveProductByIdOrSlug } = useCatalog();
  const optionalCart = useOptionalCart();

  const contextProduct = productId ? getProductByIdOrSlug(productId) : undefined;
  const [resolvedEntry, setResolvedEntry] = useState<{
    key: string;
    product: Product | null;
  } | null>(null);

  const [quantity, setQuantity] = useState(1);
  const [imgError, setImgError] = useState(false);
  const [addedFeedback, setAddedFeedback] = useState(false);

  const matchesResolvedKey = Boolean(productId && resolvedEntry?.key === productId);
  const product = contextProduct ?? (matchesResolvedKey ? (resolvedEntry?.product ?? null) : null);
  const isResolving = Boolean(
    productId && !contextProduct && (catalogLoading || !matchesResolvedKey),
  );

  useEffect(() => {
    setQuantity(1);
    setAddedFeedback(false);
  }, [productId, product?.id]);

  useEffect(() => {
    setImgError(false);
  }, [product?.imageUrl]);

  useEffect(() => {
    if (!productId || contextProduct || catalogLoading) {
      return;
    }

    let cancelled = false;

    void resolveProductByIdOrSlug(productId).then((fetched) => {
      if (!cancelled) {
        setResolvedEntry({ key: productId, product: fetched });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [productId, contextProduct, catalogLoading, resolveProductByIdOrSlug]);

  if (catalogLoading || isResolving) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div
          aria-busy="true"
          aria-label="Laster produkt"
          className="grid gap-10 lg:grid-cols-12"
        >
          <div className="aspect-[4/3] animate-pulse rounded-xl bg-linen lg:col-span-6" />
          <div className="space-y-4 lg:col-span-6">
            <div className="h-5 w-32 animate-pulse rounded bg-linen" />
            <div className="h-10 w-72 animate-pulse rounded bg-linen" />
            <div className="h-24 w-full animate-pulse rounded bg-linen" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-sand bg-ivory p-8 text-center shadow-nordic sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">Produkt</p>
          <h1 className="mt-2 font-serif text-3xl font-semibold text-espresso sm:text-4xl">
            Produktet ble ikke funnet
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-charcoal">
            Vi fant dessverre ikke produktet du lette etter. Det kan ha blitt flyttet eller fjernet
            fra katalogen.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/kategori/alle"
              className="inline-flex min-h-[44px] items-center rounded-md bg-bronze px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep"
            >
              Se alle produkter
            </Link>
            <Link
              to="/"
              className="inline-flex min-h-[44px] items-center rounded-md border border-sand bg-canvas px-5 py-2.5 text-sm font-semibold text-espresso transition-colors hover:border-bronze hover:bg-linen"
            >
              Tilbake til forsiden
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const resolvedSrc = imgError || !product.imageUrl ? DEFAULT_PRODUCT_IMAGE : product.imageUrl;
  const inStock = product.stock > 0;
  const qualifiesFreeShipping = product.priceNok >= FREE_SHIPPING_THRESHOLD_NOK;

  const handleDecrement = () => {
    setQuantity((prev) => Math.max(1, prev - 1));
  };

  const handleIncrement = () => {
    setQuantity((prev) => Math.min(Math.max(1, product.stock), prev + 1));
  };

  const handleAddToCart = () => {
    if (!inStock) {
      return;
    }
    optionalCart?.addItem(product.id, quantity);
    setAddedFeedback(true);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <nav aria-label="Brødsmulesti" className="mb-6 flex flex-wrap items-center gap-2 text-sm text-taupe">
        <Link to="/" className="hover:text-bronze">
          Forside
        </Link>
        <span aria-hidden="true">/</span>
        <Link to={`/kategori/${product.categorySlug}`} className="hover:text-bronze">
          {product.categoryName}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-medium text-espresso">{product.title}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <div className="aspect-[4/3] overflow-hidden rounded-xl border border-sand bg-ivory shadow-nordic">
            <img
              src={resolvedSrc}
              alt={product.title}
              onError={() => {
                if (!imgError) {
                  setImgError(true);
                }
              }}
              className="h-full w-full object-cover"
            />
          </div>
        </div>

        <div className="flex flex-col lg:col-span-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">
            {product.categoryName}
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold text-espresso sm:text-4xl">
            {product.title}
          </h1>

          <div className="mt-4 flex flex-wrap items-baseline gap-3">
            <span className="text-2xl font-semibold tabular-nums text-espresso sm:text-3xl">
              {formatNok(product.priceNok)}
            </span>
            <span className="text-xs text-taupe">Inkl. mva</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                inStock
                  ? 'border-success/30 bg-ivory text-success'
                  : 'border-error/30 bg-ivory text-error'
              }`}
            >
              {inStock ? `På lager (${product.stock} stk)` : 'Utsolgt'}
            </span>

            {qualifiesFreeShipping && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-linen px-3 py-1 text-xs font-medium text-espresso">
                <Truck className="h-3.5 w-3.5 text-bronze" aria-hidden="true" />
                <span>Gratis frakt</span>
              </span>
            )}
          </div>

          <p className="mt-6 text-base leading-relaxed text-charcoal">{product.description}</p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <div className="inline-flex items-center rounded-md border border-sand bg-ivory">
              <button
                type="button"
                onClick={handleDecrement}
                disabled={!inStock || quantity <= 1}
                aria-label="Reduser antall"
                className="inline-flex h-11 w-11 items-center justify-center text-espresso transition-colors hover:bg-linen disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <span
                data-testid="product-quantity"
                className="min-w-10 text-center text-sm font-semibold tabular-nums text-espresso"
              >
                {quantity}
              </span>
              <button
                type="button"
                onClick={handleIncrement}
                disabled={!inStock || quantity >= product.stock}
                aria-label="Øk antall"
                className="inline-flex h-11 w-11 items-center justify-center text-espresso transition-colors hover:bg-linen disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <button
              type="button"
              disabled={!inStock}
              onClick={handleAddToCart}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md bg-bronze px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              <span>Legg i handlekurv</span>
            </button>
          </div>

          {addedFeedback && (
            <div
              role="status"
              aria-live="polite"
              className="mt-4 inline-flex items-center gap-2 rounded-md border border-success/30 bg-ivory px-4 py-2.5 text-sm font-medium text-success"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Lagt i handlekurv</span>
            </div>
          )}

          {product.specs.length > 0 && (
            <div className="mt-10 border-t border-sand pt-6">
              <h2 className="font-serif text-xl font-semibold text-espresso">Spesifikasjoner</h2>
              <ul className="mt-3 space-y-2 text-sm text-charcoal">
                {product.specs.map((spec, index) => (
                  <li key={`${index}-${spec}`} className="flex items-start gap-2.5">
                    <span
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-bronze"
                      aria-hidden="true"
                    />
                    <span>{spec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8">
            <Link
              to={`/kategori/${product.categorySlug}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-bronze hover:text-bronze-deep"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Tilbake til {product.categoryName}</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
