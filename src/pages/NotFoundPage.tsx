import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-sand bg-ivory p-8 text-center shadow-nordic sm:p-12">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">Feilside</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-espresso sm:text-4xl">
          404 — Fant ikke siden
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-charcoal">
          Siden du prøvde å åpne finnes ikke eller har blitt flyttet.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex min-h-[44px] items-center rounded-md bg-bronze px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep"
          >
            Tilbake til forsiden
          </Link>
        </div>
      </div>
    </div>
  );
}
