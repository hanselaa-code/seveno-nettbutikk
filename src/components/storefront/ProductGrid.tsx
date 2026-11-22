import { Link } from 'react-router-dom';
import type { Product } from '../../types/domain';
import { ProductCard } from './ProductCard';

export interface ProductGridProps {
  products: Product[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  onRetry?: () => void;
  onAddToCart?: (product: Product) => void;
}

export function ProductGrid({
  products,
  loading = false,
  error = null,
  emptyMessage = 'Ingen produkter er tilgjengelige i denne visningen akkurat nå.',
  onRetry,
  onAddToCart,
}: ProductGridProps) {
  if (loading) {
    return (
      <div
        aria-busy="true"
        aria-label="Laster produkter"
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {[0, 1, 2].map((idx) => (
          <div
            key={idx}
            className="overflow-hidden rounded-lg border border-sand bg-ivory p-5 shadow-nordic"
          >
            <div className="aspect-[4/3] w-full animate-pulse rounded bg-linen" />
            <div className="mt-4 h-4 w-28 animate-pulse rounded bg-linen" />
            <div className="mt-3 h-6 w-48 animate-pulse rounded bg-linen" />
            <div className="mt-3 h-10 w-full animate-pulse rounded bg-linen" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-error/30 bg-ivory p-6 text-center shadow-nordic"
      >
        <p className="text-sm font-medium text-error">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-bronze px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
          >
            Prøv igjen
          </button>
        )}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-lg border border-sand bg-ivory p-8 text-center shadow-nordic">
        <p className="text-base text-charcoal">{emptyMessage}</p>
        <Link
          to="/kategori/alle"
          className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-bronze px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
        >
          Vis alle produkter
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />
      ))}
    </div>
  );
}
