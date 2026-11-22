import { Link, useParams } from 'react-router-dom';
import { ProductGrid } from '../components/storefront/ProductGrid';
import { useCatalog } from '../context/CatalogContext';
import { isCategorySlug } from '../lib/validators';
import { CATEGORIES, CATEGORY_MAP } from '../types/domain';

export function CategoryPage() {
  const { categorySlug } = useParams<{ categorySlug: string }>();
  const { loading, error, getProductsByCategory, refreshCatalog } = useCatalog();

  const slug = categorySlug ?? 'alle';
  const isAll = slug === 'alle';
  const isKnownCategory = isAll || isCategorySlug(slug);

  const filterTabs = [
    { slug: 'alle', label: 'Alle' },
    ...CATEGORIES.map((cat) => ({ slug: cat.slug, label: cat.name })),
  ];

  if (!isKnownCategory) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-sand bg-ivory p-8 text-center shadow-nordic sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">
            Kategori
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold text-espresso sm:text-4xl">
            Kategori ikke funnet
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-charcoal">
            Kategorien «{slug}» finnes ikke i katalogen vår. Utforsk alle tilgjengelige produkter
            eller gå tilbake til forsiden.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/kategori/alle"
              className="inline-flex min-h-[44px] items-center rounded-md bg-bronze px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep"
            >
              Vis alle produkter
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

  const categoryMeta = isAll ? null : CATEGORY_MAP[slug];
  const filteredProducts = getProductsByCategory(slug);
  const headingTitle = categoryMeta ? categoryMeta.name : 'Alle produkter';
  const headingDescription = categoryMeta
    ? categoryMeta.description
    : 'Utforsk hele Seveno-sortimentet på tvers av livsstil, interiør og uterom.';

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <div className="border-b border-sand pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">
          Kolleksjon
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-espresso sm:text-4xl">
          {headingTitle}
        </h1>
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-charcoal">
          {headingDescription}
        </p>

        <nav aria-label="Kategorifilter" className="mt-6 flex flex-wrap gap-2">
          {filterTabs.map((tab) => {
            const active = slug === tab.slug;
            return (
              <Link
                key={tab.slug}
                to={`/kategori/${tab.slug}`}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-[40px] items-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze ${
                  active
                    ? 'bg-bronze text-white'
                    : 'border border-sand bg-ivory text-espresso hover:border-bronze hover:bg-linen'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-sm text-taupe">
          {filteredProducts.length} {filteredProducts.length === 1 ? 'produkt' : 'produkter'}
        </p>
      </div>

      <div className="mt-6">
        <ProductGrid
          products={filteredProducts}
          loading={loading}
          error={error}
          emptyMessage="Ingen produkter funnet i denne kategorien akkurat nå."
          onRetry={() => void refreshCatalog()}
        />
      </div>
    </div>
  );
}
