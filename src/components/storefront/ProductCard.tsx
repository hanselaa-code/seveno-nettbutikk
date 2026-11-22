import { ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOptionalCart } from '../../context/CartContext';
import { formatNok } from '../../lib/format';
import { DEFAULT_PRODUCT_IMAGE } from '../../types/domain';
import type { Product } from '../../types/domain';

export interface ProductCardProps {
  product: Product;
  onAddToCart?: (product: Product) => void;
}

export function ProductCard({ product, onAddToCart }: ProductCardProps) {
  const [imgError, setImgError] = useState(false);
  const [addedFeedback, setAddedFeedback] = useState(false);
  const optionalCart = useOptionalCart();

  useEffect(() => {
    setImgError(false);
  }, [product.imageUrl]);

  const resolvedSrc = imgError || !product.imageUrl ? DEFAULT_PRODUCT_IMAGE : product.imageUrl;
  const inStock = product.stock > 0;

  const handleAddClick = () => {
    if (!inStock) {
      return;
    }
    if (onAddToCart) {
      onAddToCart(product);
    } else {
      optionalCart?.addItem(product.id, 1);
    }
    setAddedFeedback(true);
  };

  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-sand bg-ivory shadow-nordic transition-colors hover:border-bronze">
      <Link
        to={`/produkt/${product.slug}`}
        className="group block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
      >
        <div className="aspect-[4/3] w-full overflow-hidden border-b border-sand bg-canvas">
          <img
            src={resolvedSrc}
            alt={product.title}
            onError={() => {
              if (!imgError) {
                setImgError(true);
              }
            }}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-taupe">
            {product.categoryName}
          </p>
          <span
            className={`text-xs font-medium ${inStock ? 'text-success' : 'text-error'}`}
          >
            {inStock ? `På lager (${product.stock} stk)` : 'Utsolgt'}
          </span>
        </div>

        <Link
          to={`/produkt/${product.slug}`}
          className="mt-2 block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
        >
          <h3 className="font-serif text-2xl font-semibold text-espresso transition-colors hover:text-bronze">
            {product.title}
          </h3>
        </Link>

        <p className="mt-2 line-clamp-2 flex-1 text-sm leading-relaxed text-charcoal">
          {product.description}
        </p>

        <p className="mt-4 text-lg font-semibold tabular-nums text-espresso">
          {formatNok(product.priceNok)}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={!inStock}
            onClick={handleAddClick}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md bg-bronze px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShoppingBag className="h-4 w-4" aria-hidden="true" />
            <span>Legg i handlekurv</span>
          </button>

          <Link
            to={`/produkt/${product.slug}`}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-sand bg-canvas px-4 py-2.5 text-sm font-medium text-espresso transition-colors hover:border-bronze hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
          >
            Se produkt
          </Link>
        </div>

        {addedFeedback && (
          <p role="status" aria-live="polite" className="mt-2 text-xs font-medium text-success">
            Lagt i handlekurv
          </p>
        )}
      </div>
    </article>
  );
}
