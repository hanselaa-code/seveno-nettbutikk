import type { ReactNode } from 'react';
import { useOptionalCart } from '../../context/CartContext';
import { AiAssistantWidget } from '../ai/AiAssistantWidget';
import { CartDrawer } from '../cart/CartDrawer';
import { Footer } from './Footer';
import { Header } from './Header';

export interface LayoutProps {
  children: ReactNode;
  cartCount?: number;
  onCartClick?: () => void;
}

export function Layout({ children, cartCount, onCartClick }: LayoutProps) {
  const optionalCart = useOptionalCart();

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-canvas text-espresso">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-bronze focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Hopp til hovedinnhold
      </a>

      <Header cartCount={cartCount} onCartClick={onCartClick} />

      <main id="main-content" className="flex-1">
        {children}
      </main>

      <Footer />

      {optionalCart && <CartDrawer />}

      <AiAssistantWidget />
    </div>
  );
}
