import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProductCard } from '../../src/components/storefront/ProductCard';
import { CartProvider } from '../../src/context/CartContext';
import { CatalogProvider, useCatalog } from '../../src/context/CatalogContext';
import { CategoryPage } from '../../src/pages/CategoryPage';
import { HomePage } from '../../src/pages/HomePage';
import { ProductDetailPage } from '../../src/pages/ProductDetailPage';
import type { IProductRepository } from '../../src/repositories/productRepository';
import { getStarterProducts } from '../../src/repositories/seedCatalog';
import { DEFAULT_PRODUCT_IMAGE } from '../../src/types/domain';
import type { Product } from '../../src/types/domain';

function createMockProductRepo(overrides: Partial<IProductRepository> = {}): IProductRepository {
  return {
    listAll: vi.fn().mockResolvedValue([]),
    listActive: vi.fn().mockResolvedValue([]),
    listByCategory: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    getBySlug: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

function CatalogProbe() {
  const { products, loading, isUsingFallback } = useCatalog();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="fallback">{String(isUsingFallback)}</span>
      <span data-testid="count">{products.length}</span>
      {products.map((p) => (
        <span key={p.id}>{p.title}</span>
      ))}
    </div>
  );
}

describe('Storefront UI & CatalogContext (M2)', () => {
  it('renders HomePage with all 3 starter products, descriptions, NOK prices, and images', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <CatalogProvider>
          <CartProvider>
            <HomePage />
          </CartProvider>
        </CatalogProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', {
        name: /Tidløs nordisk estetikk for hjem, livsstil og uterom/i,
        level: 1,
      }),
    ).toBeInTheDocument();

    expect(screen.getByText('Army sekk')).toBeInTheDocument();
    expect(screen.getByText('1 890 kr')).toBeInTheDocument();
    expect(screen.getByAltText('Army sekk')).toHaveAttribute(
      'src',
      '/images/products/army-sekk.jpg',
    );

    expect(screen.getByText('Akryl gjennomsiktig skobeholder')).toBeInTheDocument();
    expect(screen.getByText('349 kr')).toBeInTheDocument();
    expect(screen.getByAltText('Akryl gjennomsiktig skobeholder')).toHaveAttribute(
      'src',
      '/images/products/skobeholder.jpg',
    );

    expect(screen.getByText('Pergola')).toBeInTheDocument();
    expect(screen.getByText('24 900 kr')).toBeInTheDocument();
    expect(screen.getByAltText('Pergola')).toHaveAttribute(
      'src',
      '/images/products/pergola.jpg',
    );
  });

  it('navigates between news slides in the Hero carousel', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <CatalogProvider>
          <CartProvider>
            <HomePage />
          </CartProvider>
        </CatalogProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', {
        name: /Tidløs nordisk estetikk for hjem, livsstil og uterom/i,
        level: 1,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Neste nyhet' }));
    expect(
      screen.getByRole('heading', {
        name: /Arkitektonisk pergola for nordisk vær og lange kvelder/i,
        level: 1,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Hjem & orden/i }));
    expect(
      screen.getByRole('heading', {
        name: /Krystallklar orden i entré og garderobe/i,
        level: 1,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Forrige nyhet' }));
    expect(
      screen.getByRole('heading', {
        name: /Arkitektonisk pergola for nordisk vær og lange kvelder/i,
        level: 1,
      }),
    ).toBeInTheDocument();
  });

  it('filters products on CategoryPage for each category slug, "alle", and unknown slug', () => {
    const renderCategory = (slug: string) =>
      render(
        <MemoryRouter initialEntries={[`/kategori/${slug}`]}>
          <CatalogProvider>
            <CartProvider>
              <Routes>
                <Route path="/kategori/:categorySlug" element={<CategoryPage />} />
              </Routes>
            </CartProvider>
          </CatalogProvider>
        </MemoryRouter>,
      );

    const living = renderCategory('seveno-living');
    expect(screen.getByRole('heading', { name: 'Seveno living', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Army sekk')).toBeInTheDocument();
    expect(screen.queryByText('Pergola')).not.toBeInTheDocument();
    expect(screen.getByText('1 produkt')).toBeInTheDocument();
    living.unmount();

    const home = renderCategory('seveno-home');
    expect(screen.getByRole('heading', { name: 'Seveno home', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Akryl gjennomsiktig skobeholder')).toBeInTheDocument();
    expect(screen.queryByText('Army sekk')).not.toBeInTheDocument();
    home.unmount();

    const outdoor = renderCategory('seveno-outdoor');
    expect(screen.getByRole('heading', { name: 'Seveno outdoor', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Pergola')).toBeInTheDocument();
    expect(screen.queryByText('Army sekk')).not.toBeInTheDocument();
    outdoor.unmount();

    const all = renderCategory('alle');
    expect(screen.getByRole('heading', { name: 'Alle produkter', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('3 produkter')).toBeInTheDocument();
    all.unmount();

    renderCategory('ukjent-kategori');
    expect(screen.getByRole('heading', { name: 'Kategori ikke funnet', level: 1 })).toBeInTheDocument();
  });

  it('resolves ProductDetailPage by slug and by distinct document id, and supports quantity + add to cart', async () => {
    const user = userEvent.setup();
    const customProduct: Product = {
      ...getStarterProducts()[0],
      id: 'firestore-doc-999',
      slug: 'eksklusiv-sekk',
      title: 'Eksklusiv Kanvas Sekk',
      priceNok: 2290,
      stock: 5,
    };

    const repo = createMockProductRepo({
      listActive: vi.fn().mockResolvedValue([customProduct]),
    });

    const slugView = render(
      <MemoryRouter initialEntries={['/produkt/army-sekk']}>
        <CatalogProvider>
          <CartProvider>
            <Routes>
              <Route path="/produkt/:productId" element={<ProductDetailPage />} />
            </Routes>
          </CartProvider>
        </CatalogProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Army sekk', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('På lager (18 stk)')).toBeInTheDocument();
    expect(screen.getByText('Volum: 28 liter')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Øk antall' }));
    expect(screen.getByTestId('product-quantity')).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: /Legg i handlekurv/i }));
    expect(screen.getByText('Lagt i handlekurv')).toBeInTheDocument();
    slugView.unmount();

    const idView = render(
      <MemoryRouter initialEntries={['/produkt/firestore-doc-999']}>
        <CatalogProvider productRepository={repo}>
          <CartProvider>
            <Routes>
              <Route path="/produkt/:productId" element={<ProductDetailPage />} />
            </Routes>
          </CartProvider>
        </CatalogProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Eksklusiv Kanvas Sekk', level: 1 }),
    ).toBeInTheDocument();
    idView.unmount();

    render(
      <MemoryRouter initialEntries={['/produkt/finnes-ikke']}>
        <CatalogProvider>
          <CartProvider>
            <Routes>
              <Route path="/produkt/:productId" element={<ProductDetailPage />} />
            </Routes>
          </CartProvider>
        </CatalogProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Produktet ble ikke funnet', level: 1 }),
    ).toBeInTheDocument();
  });

  it('falls back to DEFAULT_PRODUCT_IMAGE once on img onError without infinite loop', () => {
    const product: Product = {
      ...getStarterProducts()[0],
      imageUrl: '/images/products/missing-image.svg',
    };

    render(
      <MemoryRouter>
        <ProductCard product={product} />
      </MemoryRouter>,
    );

    const img = screen.getByAltText(product.title);
    expect(img).toHaveAttribute('src', '/images/products/missing-image.svg');

    fireEvent.error(img);
    expect(img).toHaveAttribute('src', DEFAULT_PRODUCT_IMAGE);

    // Firing error again keeps fallback without throwing or looping
    fireEvent.error(img);
    expect(img).toHaveAttribute('src', DEFAULT_PRODUCT_IMAGE);
  });

  it('CatalogContext falls back cleanly to starter products when seedCatalog fails with permission-denied', async () => {
    const repo = createMockProductRepo({
      listActive: vi.fn().mockResolvedValue([]),
      getById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockRejectedValue(new Error('Missing or insufficient permissions (permission-denied)')),
    });

    render(
      <CatalogProvider productRepository={repo}>
        <CatalogProbe />
      </CatalogProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('fallback')).toHaveTextContent('true');
    expect(screen.getByTestId('count')).toHaveTextContent('3');
    expect(screen.getByText('Army sekk')).toBeInTheDocument();
    expect(screen.getByText('Akryl gjennomsiktig skobeholder')).toBeInTheDocument();
    expect(screen.getByText('Pergola')).toBeInTheDocument();
  });
});
