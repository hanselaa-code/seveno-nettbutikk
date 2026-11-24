import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORIES, DEFAULT_PRODUCT_IMAGE } from '../../types/domain';
import type { CategorySlug } from '../../types/domain';

const CATEGORY_PREVIEW_IMAGE: Record<CategorySlug, { src: string; alt: string }> = {
  'seveno-living': {
    src: '/images/categories/seveno-living.jpg',
    alt: 'Nordisk livsstil med person langs fjorden som bærer olivengrønn Army sekk — Seveno living',
  },
  'seveno-home': {
    src: '/images/categories/seveno-home.jpg',
    alt: 'Ryddig nordisk entré og garderobe med person som organiserer sko i gjennomsiktige akryl skobeholdere — Seveno home',
  },
  'seveno-outdoor': {
    src: '/images/categories/seveno-outdoor.jpg',
    alt: 'Venner som nyter kveldssol og kaffe under moderne nordisk pergola på treterrasse — Seveno outdoor',
  },
};

interface CategoryCardImageProps {
  src: string;
  alt: string;
}

function CategoryCardImage({ src, alt }: CategoryCardImageProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [src]);

  const resolvedSrc = imgError || !src ? DEFAULT_PRODUCT_IMAGE : src;

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      onError={() => {
        if (!imgError) {
          setImgError(true);
        }
      }}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
    />
  );
}

export function CategoryCards() {
  return (
    <section id="kategorier" aria-labelledby="kategorier-heading" className="mt-14">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">
            Kategorier
          </p>
          <h2 id="kategorier-heading" className="mt-1 font-serif text-2xl font-semibold text-espresso sm:text-3xl">
            Tre universer i balanse
          </h2>
        </div>

        <Link
          to="/kategori/alle"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-bronze transition-colors hover:text-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
        >
          <span>Se alle produkter</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {CATEGORIES.map((category) => (
          <Link
            key={category.slug}
            to={`/kategori/${category.slug}`}
            className="group flex flex-col overflow-hidden rounded-lg border border-sand bg-linen transition-colors hover:border-bronze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
          >
            <div className="aspect-[16/10] w-full overflow-hidden border-b border-sand bg-ivory">
              <CategoryCardImage
                src={CATEGORY_PREVIEW_IMAGE[category.slug].src}
                alt={CATEGORY_PREVIEW_IMAGE[category.slug].alt}
              />
            </div>

            <div className="flex flex-1 flex-col p-6">
              <h3 className="font-serif text-2xl font-semibold text-espresso">{category.name}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-charcoal">
                {category.description}
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-bronze group-hover:text-bronze-deep">
                <span>Utforsk kategori</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
