import { ShieldCheck, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CategoryCards } from '../components/storefront/CategoryCards';
import { Hero } from '../components/storefront/Hero';
import { ProductGrid } from '../components/storefront/ProductGrid';
import { useCatalog } from '../context/CatalogContext';
import { CATEGORIES } from '../types/domain';

export function HomePage() {
  const { products, loading, error, refreshCatalog } = useCatalog();

  const categoryOrder = new Map(CATEGORIES.map((cat, idx) => [cat.slug, idx]));
  const orderedProducts = [...products].sort((a, b) => {
    const orderA = categoryOrder.get(a.categorySlug) ?? 99;
    const orderB = categoryOrder.get(b.categorySlug) ?? 99;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.title.localeCompare(b.title, 'nb');
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <Hero />

      <CategoryCards />

      <section aria-labelledby="utvalgte-produkter-heading" className="mt-16">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">
              Butikk
            </p>
            <h2
              id="utvalgte-produkter-heading"
              className="mt-1 font-serif text-2xl font-semibold text-espresso sm:text-3xl"
            >
              Utvalgte produkter
            </h2>
          </div>

          <Link
            to="/kategori/alle"
            className="text-sm font-semibold text-bronze transition-colors hover:text-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
          >
            Utforsk hele katalogen
          </Link>
        </div>

        <div className="mt-6">
          <ProductGrid
            products={orderedProducts}
            loading={loading}
            error={error}
            onRetry={() => void refreshCatalog()}
          />
        </div>
      </section>

      <section
        aria-label="Kundefordeler"
        className="mt-16 grid gap-6 rounded-xl border border-sand bg-linen p-6 sm:grid-cols-2 sm:p-8"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-sand bg-canvas text-bronze">
            <Truck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-serif text-xl font-semibold text-espresso">
              Gratis frakt fra 1 500 kr
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-charcoal">
              Rask og forutsigbar levering i hele Norge, med fast frakt på 99 kr under fribeløpet.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-sand bg-canvas text-bronze">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-serif text-xl font-semibold text-espresso">
              Norsk kundeservice
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-charcoal">
              Spørsmål om materialer, mål eller levering?{' '}
              <Link
                to="/kontakt"
                className="font-semibold text-bronze underline underline-offset-4 hover:text-bronze-deep"
              >
                Ta kontakt med oss
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
