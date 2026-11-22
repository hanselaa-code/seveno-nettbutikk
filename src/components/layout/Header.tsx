import { Menu, ShoppingBag, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useOptionalCart } from '../../context/CartContext';

export interface HeaderProps {
  cartCount?: number;
  onCartClick?: () => void;
}

interface NavItem {
  label: string;
  to: string;
  end?: boolean;
}

const DESKTOP_NAV_ITEMS: readonly NavItem[] = [
  { label: 'Hjem', to: '/', end: true },
  { label: 'Seveno living', to: '/kategori/seveno-living' },
  { label: 'Seveno home', to: '/kategori/seveno-home' },
  { label: 'Seveno outdoor', to: '/kategori/seveno-outdoor' },
  { label: 'Kontakt', to: '/kontakt' },
  { label: 'Admin', to: '/admin' },
];

const MOBILE_NAV_ITEMS: readonly NavItem[] = [
  { label: 'Hjem', to: '/', end: true },
  { label: 'Alle produkter', to: '/kategori/alle' },
  { label: 'Seveno living', to: '/kategori/seveno-living' },
  { label: 'Seveno home', to: '/kategori/seveno-home' },
  { label: 'Seveno outdoor', to: '/kategori/seveno-outdoor' },
  { label: 'Kontakt', to: '/kontakt' },
  { label: 'Admin', to: '/admin' },
];

export function Header({ cartCount, onCartClick }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const optionalCart = useOptionalCart();
  const resolvedCartCount = cartCount ?? optionalCart?.totalItems ?? 0;

  const location = useLocation();
  const navigate = useNavigate();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const previousOverflow =
      typeof document !== 'undefined' ? document.body.style.overflow : '';
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
    }

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key === 'Tab' && mobileDrawerRef.current) {
        const focusables = Array.from(
          mobileDrawerRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled'));

        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (event.shiftKey) {
          if (active === first || !mobileDrawerRef.current.contains(active)) {
            event.preventDefault();
            last.focus();
          }
        } else if (active === last || !mobileDrawerRef.current.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (typeof document !== 'undefined') {
        document.body.style.overflow = previousOverflow;
      }
    };
  }, [mobileOpen]);

  const handleCartClick = () => {
    if (onCartClick) {
      onCartClick();
      return;
    }
    if (optionalCart) {
      optionalCart.openDrawer();
      return;
    }
    navigate('/utsjekk');
  };

  const handleCloseDrawer = () => {
    setMobileOpen(false);
    menuButtonRef.current?.focus();
  };

  const desktopLinkClass = ({ isActive }: { isActive: boolean }) =>
    [
      'whitespace-nowrap text-xs font-medium tracking-wide transition-colors lg:text-sm',
      'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bronze',
      isActive
        ? 'border-b-2 border-bronze pb-0.5 font-semibold text-bronze'
        : 'text-charcoal hover:text-bronze',
    ].join(' ');

  const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
    [
      'flex min-h-[44px] items-center rounded-md px-3 py-2 text-base font-medium transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze',
      isActive
        ? 'bg-linen font-semibold text-bronze'
        : 'text-espresso hover:bg-ivory hover:text-bronze',
    ].join(' ');

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-sand bg-canvas/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:h-[68px] sm:px-6 lg:px-8">
          <Link
            to="/"
            aria-label="Seveno forside"
            className="shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
          >
            <div className="h-10 w-32 overflow-hidden sm:h-11 sm:w-36 lg:w-40">
              <img
                src="/images/seveno-logo.jpg"
                alt="Seveno logo"
                className="h-full w-full object-cover object-center"
              />
            </div>
          </Link>

          <nav aria-label="Hovedmeny" className="hidden items-center gap-3.5 md:flex lg:gap-6">
            {DESKTOP_NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={desktopLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleCartClick}
              aria-label={`Handlekurv (${resolvedCartCount} ${resolvedCartCount === 1 ? 'vare' : 'varer'})`}
              className="relative inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-md border border-sand bg-ivory px-3 py-2 text-xs font-medium text-espresso transition-colors hover:border-bronze hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze sm:text-sm"
            >
              <ShoppingBag className="h-4 w-4 text-bronze" aria-hidden="true" />
              <span>Handlekurv</span>
              <span
                data-testid="cart-badge"
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-bronze px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white"
              >
                {resolvedCartCount}
              </span>
            </button>

            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Åpne meny"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-drawer"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-sand bg-canvas text-espresso transition-colors hover:bg-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze md:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            data-testid="mobile-menu-backdrop"
            className="fixed inset-0 bg-espresso/40"
            onClick={handleCloseDrawer}
            aria-hidden="true"
          />

          <div
            ref={mobileDrawerRef}
            id="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Mobilmeny"
            className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col border-l border-sand bg-canvas p-6 shadow-nordic"
          >
            <div className="flex items-center justify-between border-b border-sand pb-4">
              <span className="font-serif text-xl font-semibold text-espresso">Meny</span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={handleCloseDrawer}
                aria-label="Lukk meny"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-sand bg-ivory text-espresso transition-colors hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <nav aria-label="Mobilnavigasjon" className="mt-4 flex flex-1 flex-col gap-1 overflow-y-auto">
              {MOBILE_NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={mobileLinkClass}
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="mt-6 border-t border-sand pt-4">
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  handleCartClick();
                }}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-bronze px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze"
              >
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                <span>Gå til handlekurv ({resolvedCartCount})</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
