import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden rounded-xl border border-sand bg-ivory p-7 shadow-nordic sm:p-10 lg:p-14"
    >
      <div className="h-1 w-20 rounded-full bg-gold-light" aria-hidden="true" />

      <div className="mt-6 grid items-center gap-8 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-bronze">
            Nordisk kolleksjon
          </p>
          <h1
            id="hero-heading"
            className="mt-3 font-serif text-3xl font-semibold leading-tight tracking-tight text-espresso sm:text-5xl"
          >
            Tidløs nordisk estetikk for hjem, livsstil og uterom
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-charcoal sm:text-lg">
            Gjennomtenkte produkter i rolige naturtoner, varige materialer og rene linjer —
            skapt for å løfte både hverdagen og rommene du lever i.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3.5">
            <Link
              to="/kategori/alle"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-bronze px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
            >
              <span>Utforsk kolleksjonen</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>

            <Link
              to="/kontakt"
              className="inline-flex min-h-[44px] items-center rounded-md border border-sand bg-canvas px-6 py-3 text-sm font-semibold text-espresso transition-colors hover:border-bronze hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
            >
              Kontakt oss
            </Link>
          </div>
        </div>

        <div className="hidden lg:col-span-4 lg:flex lg:justify-end">
          <div className="flex h-56 w-56 flex-col items-center justify-center rounded-xl border border-sand bg-linen p-6 text-center shadow-nordic">
            <svg
              viewBox="0 0 120 120"
              className="h-24 w-24"
              aria-hidden="true"
              role="presentation"
            >
              <circle
                cx="60"
                cy="60"
                r="46"
                fill="none"
                stroke="#996E44"
                strokeWidth="3.5"
              />
              <path
                d="M44 41h34L54 83"
                fill="none"
                stroke="#7D5832"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="mt-3 font-serif text-lg font-semibold text-espresso">Seveno Studio</p>
            <p className="mt-1 text-xs text-taupe">Nordisk form og funksjon</p>
          </div>
        </div>
      </div>
    </section>
  );
}
