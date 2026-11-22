import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { CatalogProvider } from './context/CatalogContext';
import { AdminPage } from './pages/AdminPage';
import { CategoryPage } from './pages/CategoryPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { ContactPage } from './pages/ContactPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProductDetailPage } from './pages/ProductDetailPage';

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo(0, 0);
    }
  }, [pathname]);

  return null;
}

export function App() {
  return (
    <AuthProvider>
      <CatalogProvider>
        <CartProvider>
          <ScrollToTop />
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/kategori" element={<Navigate to="/kategori/alle" replace />} />
              <Route path="/kategori/:categorySlug" element={<CategoryPage />} />
              <Route path="/produkt/:productId" element={<ProductDetailPage />} />
              <Route path="/kontakt" element={<ContactPage />} />
              <Route path="/utsjekk" element={<CheckoutPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Layout>
        </CartProvider>
      </CatalogProvider>
    </AuthProvider>
  );
}

export default App;
