import { Link } from 'react-router-dom';

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-sand bg-linen text-charcoal">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <p className="font-serif text-xl font-semibold text-espresso">Seveno Nettbutikk</p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-taupe">
              Nordisk form og funksjon — skapt for varige rom.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-lg font-semibold text-espresso">Kategorier</h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link
                  to="/kategori/alle"
                  className="text-charcoal transition-colors hover:text-bronze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
                >
                  Alle produkter
                </Link>
              </li>
              <li>
                <Link
                  to="/kategori/seveno-living"
                  className="text-charcoal transition-colors hover:text-bronze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
                >
                  Seveno living
                </Link>
              </li>
              <li>
                <Link
                  to="/kategori/seveno-home"
                  className="text-charcoal transition-colors hover:text-bronze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
                >
                  Seveno home
                </Link>
              </li>
              <li>
                <Link
                  to="/kategori/seveno-outdoor"
                  className="text-charcoal transition-colors hover:text-bronze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
                >
                  Seveno outdoor
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-lg font-semibold text-espresso">Kundeservice</h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link
                  to="/kontakt"
                  className="text-charcoal transition-colors hover:text-bronze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
                >
                  Kontakt oss
                </Link>
              </li>
              <li>
                <Link
                  to="/utsjekk"
                  className="text-charcoal transition-colors hover:text-bronze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
                >
                  Utsjekk
                </Link>
              </li>
              <li>
                <Link
                  to="/admin"
                  className="text-charcoal transition-colors hover:text-bronze focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
                >
                  Admin
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-2 border-t border-sand/80 pt-6 text-xs text-taupe sm:flex-row sm:items-center">
          <p>© {year} Seveno Nettbutikk. Alle rettigheter forbeholdt.</p>
          <p>Tidløs nordisk estetikk</p>
        </div>
      </div>
    </footer>
  );
}
