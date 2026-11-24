import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_PRODUCT_IMAGE } from '../../types/domain';

interface HeroNewsSlide {
  id: string;
  badge: string;
  shortLabel: string;
  title: string;
  description: string;
  imageUrl: string;
  imageAlt: string;
  primaryCta: { label: string; to: string };
  secondaryCta: { label: string; to: string };
}

export const HERO_NEWS_SLIDES: readonly HeroNewsSlide[] = [
  {
    id: 'nordisk-kolleksjon',
    badge: 'Nyhet · Nordisk kolleksjon',
    shortLabel: 'Kolleksjon',
    title: 'Tidløs nordisk estetikk for hjem, livsstil og uterom',
    description:
      'Gjennomtenkte produkter i rolige naturtoner, varige materialer og rene linjer — skapt for å løfte både hverdagen og rommene du lever i.',
    imageUrl: '/images/hero/nordic-collection.jpg',
    imageAlt:
      'Moderne nordisk hjem med eikegulv, elfenbensfargede vegger og glassdører ut mot terrasse med pergola i kveldssol',
    primaryCta: { label: 'Utforsk kolleksjonen', to: '/kategori/alle' },
    secondaryCta: { label: 'Kontakt oss', to: '/kontakt' },
  },
  {
    id: 'nyhet-pergola',
    badge: 'Nyhet · Seveno outdoor',
    shortLabel: 'Uterom & pergola',
    title: 'Arkitektonisk pergola for nordisk vær og lange kvelder',
    description:
      'Pulverlakkert aluminium med trinnløst justerbare taklameller og skjult drenering i stolpene — skap en lun uteplass hele sesongen.',
    imageUrl: '/images/categories/seveno-outdoor.jpg',
    imageAlt:
      'Venner og familie samlet rundt utebord under en moderne mørk aluminiumspergola i varm kveldssol',
    primaryCta: { label: 'Se Pergola', to: '/produkt/pergola' },
    secondaryCta: { label: 'Utforsk Seveno outdoor', to: '/kategori/seveno-outdoor' },
  },
  {
    id: 'nyhet-skobeholder',
    badge: 'Nyhet · Seveno home',
    shortLabel: 'Hjem & orden',
    title: 'Krystallklar orden i entré og garderobe',
    description:
      'Stabelbare oppbevaringsbokser i 4 mm optisk akryl med magnetisk frontdør — beskytt favorittskoene mot støv med et ryddig uttrykk.',
    imageUrl: '/images/categories/seveno-home.jpg',
    imageAlt:
      'Ryddig nordisk entré og garderobe i lys eik med gjennomsiktige akryl skobeholdere i stabler',
    primaryCta: { label: 'Se skobeholder', to: '/produkt/akryl-gjennomsiktig-skobeholder' },
    secondaryCta: { label: 'Utforsk Seveno home', to: '/kategori/seveno-home' },
  },
  {
    id: 'nyhet-army-sekk',
    badge: 'Nyhet · Seveno living',
    shortLabel: 'Livsstil & sekk',
    title: 'Laget for by, fjord og aktiv hverdag',
    description:
      'Slitesterk Army sekk i vokset kanvas med forsterket bunn, polstret 16-tommers PC-lomme og børstede bronsedetaljer.',
    imageUrl: '/images/categories/seveno-living.jpg',
    imageAlt:
      'Person på tur langs nordisk brygge i gyllent lys med olivengrønn Army sekk i vokset kanvas',
    primaryCta: { label: 'Se Army sekk', to: '/produkt/army-sekk' },
    secondaryCta: { label: 'Utforsk Seveno living', to: '/kategori/seveno-living' },
  },
] as const;

const AUTOPLAY_INTERVAL_MS = 6500;

export function Hero() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isHoveredOrFocused, setIsHoveredOrFocused] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const slideCount = HERO_NEWS_SLIDES.length;
  const activeSlide = HERO_NEWS_SLIDES[activeIndex] ?? HERO_NEWS_SLIDES[0];

  const goToNext = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % slideCount);
  }, [slideCount]);

  const goToPrev = useCallback(() => {
    setActiveIndex((prev) => (prev - 1 + slideCount) % slideCount);
  }, [slideCount]);

  useEffect(() => {
    if (isPaused || isHoveredOrFocused) {
      return;
    }
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const timer = window.setInterval(goToNext, AUTOPLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isPaused, isHoveredOrFocused, goToNext]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goToNext();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goToPrev();
    }
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Aktuelle nyheter fra Seveno"
      onMouseEnter={() => setIsHoveredOrFocused(true)}
      onMouseLeave={() => setIsHoveredOrFocused(false)}
      onFocus={() => setIsHoveredOrFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsHoveredOrFocused(false);
        }
      }}
      onKeyDown={handleKeyDown}
      className="relative overflow-hidden rounded-xl border border-sand bg-espresso shadow-nordic"
    >
      {/* Background images with crossfade */}
      <div className="absolute inset-0" aria-hidden="true">
        {HERO_NEWS_SLIDES.map((slide, index) => {
          const isCurrent = index === activeIndex;
          const src = failedImages[slide.id] ? DEFAULT_PRODUCT_IMAGE : slide.imageUrl;
          return (
            <img
              key={slide.id}
              src={src}
              alt=""
              onError={() => {
                setFailedImages((prev) => (prev[slide.id] ? prev : { ...prev, [slide.id]: true }));
              }}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
                isCurrent ? 'opacity-100' : 'opacity-0'
              }`}
            />
          );
        })}
        {/* Accessible warm dark scrim for crisp readability across desktop and mobile */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#1F1A17]/90 via-[#1F1A17]/70 to-[#1F1A17]/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1F1A17]/75 via-transparent to-[#1F1A17]/20" />
      </div>

      {/* Hidden accessible alt image reference for active slide */}
      <span className="sr-only">{activeSlide.imageAlt}</span>

      {/* Foreground content */}
      <div className="relative z-10 flex min-h-[430px] flex-col justify-between p-6 sm:min-h-[480px] sm:p-10 lg:min-h-[520px] lg:p-14">
        <div className="max-w-2xl" aria-live="polite" aria-atomic="true">
          <div className="inline-flex items-center gap-2 rounded-full border border-gold-light/40 bg-[#1F1A17]/60 px-3.5 py-1.5 backdrop-blur-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-gold-light" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-light">
              {activeSlide.badge}
            </p>
          </div>

          <h1
            id="hero-heading"
            className="mt-5 font-serif text-3xl font-semibold leading-tight tracking-tight text-ivory sm:text-5xl"
          >
            {activeSlide.title}
          </h1>

          <p className="mt-4 max-w-xl text-base leading-relaxed text-linen/95 sm:text-lg">
            {activeSlide.description}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3.5">
            <Link
              to={activeSlide.primaryCta.to}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-bronze px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light"
            >
              <span>{activeSlide.primaryCta.label}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>

            <Link
              to={activeSlide.secondaryCta.to}
              className="inline-flex min-h-[44px] items-center rounded-md border border-ivory/40 bg-[#1F1A17]/55 px-6 py-3 text-sm font-semibold text-ivory backdrop-blur-xs transition-colors hover:border-gold-light hover:bg-[#1F1A17]/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light"
            >
              {activeSlide.secondaryCta.label}
            </Link>
          </div>
        </div>

        {/* Bottom carousel navigation bar */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-ivory/20 pt-5">
          {/* Slide selector pills */}
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Velg nyhet">
            {HERO_NEWS_SLIDES.map((slide, index) => {
              const isCurrent = index === activeIndex;
              return (
                <button
                  key={slide.id}
                  type="button"
                  role="tab"
                  aria-selected={isCurrent}
                  aria-label={`Vis nyhet ${index + 1} av ${slideCount}: ${slide.shortLabel}`}
                  onClick={() => setActiveIndex(index)}
                  className={`inline-flex min-h-[36px] items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light ${
                    isCurrent
                      ? 'bg-ivory text-espresso'
                      : 'border border-ivory/30 bg-[#1F1A17]/50 text-ivory/90 hover:border-gold-light hover:bg-[#1F1A17]/75'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isCurrent ? 'bg-bronze' : 'bg-ivory/60'
                    }`}
                    aria-hidden="true"
                  />
                  <span>{slide.shortLabel}</span>
                </button>
              );
            })}
          </div>

          {/* Prev / Next / Pause controls */}
          <div className="flex items-center gap-2">
            <span className="mr-1 text-xs font-medium tabular-nums text-ivory/85">
              {activeIndex + 1} / {slideCount}
            </span>

            <button
              type="button"
              onClick={() => setIsPaused((prev) => !prev)}
              aria-label={isPaused ? 'Start automatisk bildebytte' : 'Sett bildebytte på pause'}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-ivory/35 bg-[#1F1A17]/55 text-ivory backdrop-blur-xs transition-colors hover:border-gold-light hover:bg-[#1F1A17]/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light"
            >
              {isPaused ? (
                <Play className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Pause className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={goToPrev}
              aria-label="Forrige nyhet"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-ivory/35 bg-[#1F1A17]/55 text-ivory backdrop-blur-xs transition-colors hover:border-gold-light hover:bg-[#1F1A17]/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={goToNext}
              aria-label="Neste nyhet"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-ivory/35 bg-[#1F1A17]/55 text-ivory backdrop-blur-xs transition-colors hover:border-gold-light hover:bg-[#1F1A17]/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
