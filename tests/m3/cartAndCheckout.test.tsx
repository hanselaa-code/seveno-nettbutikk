import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { CartDrawer } from '../../src/components/cart/CartDrawer';
import { PaymentSelector } from '../../src/components/checkout/PaymentSelector';
import { Header } from '../../src/components/layout/Header';
import { CART_STORAGE_KEY, CartProvider, useCart } from '../../src/context/CartContext';
import { CatalogProvider } from '../../src/context/CatalogContext';
import { ensureAnonymousUserUid } from '../../src/lib/firebase';
import {
  FirestoreOrderRepository,
  LocalOrderRepository,
  getOrderRepository,
  resolveCheckoutOwnerUid,
} from '../../src/repositories/orderRepository';
import { FirestoreProductRepository } from '../../src/repositories/productRepository';
import type { IProductRepository } from '../../src/repositories/productRepository';
import { getStarterProducts } from '../../src/repositories/seedCatalog';
import { CheckoutPage } from '../../src/pages/CheckoutPage';
import { createDefaultPaymentRegistry } from '../../src/services/payments/registry';
import { DEFAULT_PRODUCT_IMAGE } from '../../src/types/domain';
import type { PaymentProviderId, Product } from '../../src/types/domain';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    signInAnonymously: vi.fn(),
  };
});

import { signInAnonymously } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

function CartHarness() {
  const cart = useCart();
  return (
    <div>
      <span data-testid="total-items">{cart.totalItems}</span>
      <span data-testid="subtotal">{cart.subtotalNok}</span>
      <span data-testid="shipping">{cart.shippingNok}</span>
      <span data-testid="mva">{cart.mvaNok}</span>
      <span data-testid="total">{cart.totalNok}</span>
      <span data-testid="items-json">{JSON.stringify(cart.items)}</span>
      <button type="button" onClick={() => cart.addItem('skobeholder-test', 2)}>
        AddSkobeholder
      </button>
      <button type="button" onClick={() => cart.addItem('skobeholder-test', 10)}>
        AddOverStock
      </button>
      <button type="button" onClick={() => cart.updateQuantity('skobeholder-test', 0)}>
        ZeroQty
      </button>
      <button type="button" onClick={() => cart.addItem('out-of-stock', 1)}>
        AddOutOfStock
      </button>
      <button type="button" onClick={() => cart.addItem('army-sekk-test', 1)}>
        AddArmy
      </button>
      <button type="button" onClick={() => cart.removeItem('army-sekk-test')}>
        RemoveArmy
      </button>
      <button type="button" onClick={() => cart.clearCart()}>
        ClearAll
      </button>
    </div>
  );
}

const sampleProducts: Product[] = [
  {
    id: 'skobeholder-test',
    slug: 'skobeholder-test',
    title: 'Akryl gjennomsiktig skobeholder',
    categorySlug: 'seveno-home',
    categoryName: 'Seveno home',
    description: 'Beskrivelse av skobeholder.',
    priceNok: 349,
    stock: 4,
    imageUrl: '/images/products/skobeholder.svg',
    specs: [],
    active: true,
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
  },
  {
    id: 'army-sekk-test',
    slug: 'army-sekk-test',
    title: 'Army sekk',
    categorySlug: 'seveno-living',
    categoryName: 'Seveno living',
    description: 'Beskrivelse av army sekk.',
    priceNok: 1890,
    stock: 18,
    imageUrl: '/images/products/army-sekk.svg',
    specs: [],
    active: true,
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
  },
  {
    id: 'out-of-stock',
    slug: 'out-of-stock',
    title: 'Utsolgt produkt',
    categorySlug: 'seveno-home',
    categoryName: 'Seveno home',
    description: 'Utsolgt vare.',
    priceNok: 500,
    stock: 0,
    imageUrl: '/images/products/seveno-default.svg',
    specs: [],
    active: true,
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
  },
];

describe('M3 Cart, Drawer, Checkout & Order Repository', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.style.overflow = '';
    vi.clearAllMocks();
  });

  it('persists CartContext in localStorage, caps quantities at stock, handles corrupt JSON, and calculates MVA/shipping', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(CART_STORAGE_KEY, '{corrupt-json');

    const { unmount } = render(
      <CartProvider products={sampleProducts}>
        <CartHarness />
      </CartProvider>,
    );

    expect(screen.getByTestId('total-items')).toHaveTextContent('0');

    // Out-of-stock item is rejected
    await user.click(screen.getByText('AddOutOfStock'));
    expect(screen.getByTestId('total-items')).toHaveTextContent('0');

    // Add 2x 349 = 698 (< 1500 => 99 shipping, 797 total, 159 mva)
    await user.click(screen.getByText('AddSkobeholder'));
    expect(screen.getByTestId('total-items')).toHaveTextContent('2');
    expect(screen.getByTestId('subtotal')).toHaveTextContent('698');
    expect(screen.getByTestId('shipping')).toHaveTextContent('99');
    expect(screen.getByTestId('total')).toHaveTextContent('797');
    expect(screen.getByTestId('mva')).toHaveTextContent('159');

    // Adding 10 caps at stock (4)
    await user.click(screen.getByText('AddOverStock'));
    expect(screen.getByTestId('total-items')).toHaveTextContent('4');

    // Persisted to localStorage
    const stored = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? '[]');
    expect(stored).toEqual([{ productId: 'skobeholder-test', quantity: 4 }]);
    unmount();

    // Hydrates from localStorage on fresh mount
    render(
      <CartProvider products={sampleProducts}>
        <CartHarness />
      </CartProvider>,
    );
    expect(screen.getByTestId('total-items')).toHaveTextContent('4');

    // updateQuantity(id, 0) removes item
    await user.click(screen.getByText('ZeroQty'));
    expect(screen.getByTestId('total-items')).toHaveTextContent('0');

    // Free shipping threshold >= 1500 (Army sekk = 1890)
    await user.click(screen.getByText('AddArmy'));
    expect(screen.getByTestId('shipping')).toHaveTextContent('0');
    expect(screen.getByTestId('total')).toHaveTextContent('1890');
    expect(screen.getByTestId('mva')).toHaveTextContent('378');

    await user.click(screen.getByText('RemoveArmy'));
    expect(screen.getByTestId('total-items')).toHaveTextContent('0');
  });

  it('opens CartDrawer from Header, supports singular 1 vare aria-label, quantity edits, image fallback, focus trap, Escape/backdrop close, and /utsjekk link', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    // Add 1 item from HomePage -> addItem must NOT auto-open CartDrawer
    const addButtons = screen.getAllByRole('button', { name: /Legg i handlekurv/i });
    await user.click(addButtons[0]);
    expect(screen.queryByRole('dialog', { name: 'Handlekurv' })).not.toBeInTheDocument();

    // Singular "1 vare" aria-label
    const cartTrigger = screen.getByRole('button', { name: 'Handlekurv (1 vare)' });
    await user.click(cartTrigger);

    const drawer = screen.getByRole('dialog', { name: 'Handlekurv' });
    expect(drawer).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    // Increment & decrement inside drawer
    const incBtn = within(drawer).getByRole('button', { name: /Øk antall for/i });
    await user.click(incBtn);
    expect(screen.getByTestId('cart-badge')).toHaveTextContent('2');

    // Image error falls back once to DEFAULT_PRODUCT_IMAGE
    const img = within(drawer).getByRole('img');
    fireEvent.error(img);
    expect(img).toHaveAttribute('src', DEFAULT_PRODUCT_IMAGE);

    // Tab focus trap keeps focus inside drawer
    await user.tab();
    expect(drawer.contains(document.activeElement)).toBe(true);

    // Escape closes drawer and restores focus & body scroll
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Handlekurv' })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');

    // Reopen and close via backdrop click
    await user.click(screen.getByRole('button', { name: /Handlekurv \(2 varer\)/i }));
    expect(screen.getByRole('dialog', { name: 'Handlekurv' })).toBeInTheDocument();
    await user.click(screen.getByTestId('cart-drawer-backdrop'));
    expect(screen.queryByRole('dialog', { name: 'Handlekurv' })).not.toBeInTheDocument();

    // Reopen, remove item -> shows empty state
    await user.click(screen.getByRole('button', { name: /Handlekurv \(2 varer\)/i }));
    const openDrawer = screen.getByRole('dialog', { name: 'Handlekurv' });
    await user.click(within(openDrawer).getByRole('button', { name: 'Fjern' }));
    expect(within(openDrawer).getByText('Din handlekurv er tom')).toBeInTheDocument();
  });

  it('navigates from CartDrawer "Gå til utsjekk" to /utsjekk and renders empty-cart state with <h1>Utsjekk</h1>', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <CartProvider products={sampleProducts} initialItems={[{ productId: 'army-sekk-test', quantity: 1 }]}>
          <Header />
          <CartDrawer />
        </CartProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Handlekurv (1 vare)' }));
    const link = screen.getByRole('link', { name: 'Gå til utsjekk' });
    expect(link).toHaveAttribute('href', '/utsjekk');

    render(
      <MemoryRouter initialEntries={['/utsjekk']}>
        <CartProvider initialItems={[]}>
          <CheckoutPage />
        </CartProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Utsjekk', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Handlekurven din er tom')).toBeInTheDocument();
  });

  it('shows inline role="alert" validation errors on invalid checkout input without calling payment or orderRepo', async () => {
    const user = userEvent.setup();
    const orderRepo = new LocalOrderRepository('test_orders_validation');
    const createSpy = vi.spyOn(orderRepo, 'create');
    const registry = createDefaultPaymentRegistry();
    const starter = getStarterProducts();

    render(
      <MemoryRouter>
        <CartProvider
          products={starter}
          initialItems={[{ productId: 'akryl-gjennomsiktig-skobeholder', quantity: 2 }]}
        >
          <CheckoutPage
            orderRepo={orderRepo}
            paymentRegistry={registry}
            resolveOwnerUid={async () => 'guest-1'}
          />
        </CartProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Postnummer (4 siffer)'), '12');
    await user.click(screen.getByRole('button', { name: 'Fullfør testbestilling' }));

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(5);
    expect(screen.getByLabelText('Fullt navn')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Postnummer (4 siffer)')).toHaveAttribute('aria-invalid', 'true');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('displays Vipps, Klarna, and Testbestilling in PaymentSelector with sandbox readiness badges', async () => {
    const user = userEvent.setup();
    const registry = createDefaultPaymentRegistry();
    const onSelect = vi.fn();

    render(
      <PaymentSelector
        providers={registry.list()}
        selectedProviderId="test_order"
        onSelect={onSelect}
      />,
    );

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([
      'vipps',
      'klarna',
      'test_order',
    ]);
    expect(screen.getAllByText('Klargjort integrasjon (Testmodus)')).toHaveLength(2);

    await user.click(screen.getByRole('radio', { name: /Klarna/i }));
    expect(onSelect).toHaveBeenCalledWith('klarna');
  });

  it.each<PaymentProviderId>(['test_order', 'klarna', 'vipps'])(
    'completes checkout end-to-end for provider %s, clears cart, and renders OrderConfirmation',
    async (providerId) => {
      const user = userEvent.setup();
      const orderRepo = new LocalOrderRepository(`test_orders_${providerId}`);
      const registry = createDefaultPaymentRegistry();
      const starter = getStarterProducts();
      const storageKey = `test_cart_${providerId}`;

      render(
        <MemoryRouter>
          <CartProvider
            products={starter}
            storageKey={storageKey}
            initialItems={[{ productId: 'akryl-gjennomsiktig-skobeholder', quantity: 2 }]}
          >
            <CheckoutPage
              orderRepo={orderRepo}
              paymentRegistry={registry}
              resolveOwnerUid={async () => 'guest-e2e-1'}
            />
          </CartProvider>
        </MemoryRouter>,
      );

      await user.type(screen.getByLabelText('Fullt navn'), 'Kari Nordmann');
      await user.type(screen.getByLabelText('E-postadresse'), 'kari@eksempel.no');
      await user.type(screen.getByLabelText('Telefon'), '91234567');
      await user.type(screen.getByLabelText('Gateadresse'), 'Storgata 10');
      await user.type(screen.getByLabelText('Postnummer (4 siffer)'), '0155');
      await user.type(screen.getByLabelText('Poststed'), 'Oslo');

      const radio = screen
        .getAllByRole('radio')
        .find((el) => (el as HTMLInputElement).value === providerId);
      expect(radio).toBeDefined();
      await user.click(radio!);

      await user.click(screen.getByRole('button', { name: 'Fullfør testbestilling' }));

      expect(await screen.findByText('Takk for din bestilling!')).toBeInTheDocument();
      expect(screen.getByText('Ordrebekreftelse')).toBeInTheDocument();
      expect(screen.getByTestId('order-number').textContent).toMatch(/^SEV-\d{4}-[A-Z0-9]{8}$/);
      expect(screen.getByText('Kari Nordmann')).toBeInTheDocument();
      expect(screen.getByText('Betalt (testordre)')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Fortsett å handle' })).toHaveAttribute(
        'href',
        '/kategori/alle',
      );

      const savedOrders = await orderRepo.listByOwner('guest-e2e-1');
      expect(savedOrders).toHaveLength(1);
      expect(savedOrders[0].paymentProvider).toBe(providerId);
      expect(savedOrders[0].totalNok).toBe(797);
      expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')).toEqual([]);
    },
  );

  it('prevents double submission while order creation is in flight', async () => {
    const user = userEvent.setup();
    const orderRepo = new LocalOrderRepository('test_orders_lock');
    let resolveCreate!: (value: Awaited<ReturnType<LocalOrderRepository['create']>>) => void;
    const deferredCreate = new Promise<Awaited<ReturnType<LocalOrderRepository['create']>>>(
      (resolve) => {
        resolveCreate = resolve;
      },
    );
    const originalCreate = orderRepo.create.bind(orderRepo);
    const createSpy = vi
      .spyOn(orderRepo, 'create')
      .mockImplementation(async (input) => {
        const result = await originalCreate(input);
        resolveCreate(result);
        return deferredCreate;
      });

    let gateResolver!: () => void;
    const gate = new Promise<string>((resolve) => {
      gateResolver = () => resolve('guest-lock');
    });

    render(
      <MemoryRouter>
        <CartProvider
          products={getStarterProducts()}
          initialItems={[{ productId: 'army-sekk', quantity: 1 }]}
        >
          <CheckoutPage
            orderRepo={orderRepo}
            paymentRegistry={createDefaultPaymentRegistry()}
            resolveOwnerUid={() => gate}
          />
        </CartProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Fullt navn'), 'Ola Nordmann');
    await user.type(screen.getByLabelText('E-postadresse'), 'ola@eksempel.no');
    await user.type(screen.getByLabelText('Telefon'), '91234567');
    await user.type(screen.getByLabelText('Gateadresse'), 'Storgata 10');
    await user.type(screen.getByLabelText('Postnummer (4 siffer)'), '0155');
    await user.type(screen.getByLabelText('Poststed'), 'Oslo');

    const submitBtn = screen.getByRole('button', { name: 'Fullfør testbestilling' });
    await user.click(submitBtn);
    expect(screen.getByRole('button', { name: 'Fullfører bestilling ...' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Fullfører bestilling ...' }));
    gateResolver();

    expect(await screen.findByText('Takk for din bestilling!')).toBeInTheDocument();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('catches permission-denied for deactivated items in FirestoreOrderRepository, preserves cart/form on CheckoutPage, and guards invalid IDs', async () => {
    const user = userEvent.setup();
    const fakeProductRepo: IProductRepository = {
      listAll: async () => [],
      listActive: async () => [],
      listByCategory: async () => [],
      getById: async () => {
        throw Object.assign(new Error('Missing or insufficient permissions.'), {
          code: 'permission-denied',
        });
      },
      getBySlug: async () => null,
      create: async () => {
        throw new Error('not implemented');
      },
      update: async () => {
        throw new Error('not implemented');
      },
      delete: async () => undefined,
    };

    const fakeDb = {} as Firestore;
    const firestoreOrderRepo = new FirestoreOrderRepository(fakeDb, fakeProductRepo);

    // Invalid IDs return null cleanly without throwing
    expect(await firestoreOrderRepo.getById('')).toBeNull();
    expect(await firestoreOrderRepo.getById('.')).toBeNull();
    expect(await firestoreOrderRepo.getById('..')).toBeNull();
    expect(await firestoreOrderRepo.getById('foo/bar')).toBeNull();
    expect(await firestoreOrderRepo.listByOwner('   ')).toEqual([]);

    const prodRepo = new FirestoreProductRepository(fakeDb);
    expect(await prodRepo.getById('.')).toBeNull();
    expect(await prodRepo.getById('..')).toBeNull();
    expect(await prodRepo.getBySlug('.')).toBeNull();
    expect(await prodRepo.getBySlug('..')).toBeNull();

    // CheckoutPage preserves cart and form when orderRepo.create rejects deactivated item
    render(
      <MemoryRouter>
        <CatalogProvider>
          <CartProvider initialItems={[{ productId: 'deactivated-prod', quantity: 1 }]}>
            <CheckoutPage
              orderRepo={firestoreOrderRepo}
              paymentRegistry={createDefaultPaymentRegistry()}
              resolveOwnerUid={async () => 'guest-deactivated'}
            />
          </CartProvider>
        </CatalogProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Fullt navn'), 'Ola Nordmann');
    await user.type(screen.getByLabelText('E-postadresse'), 'ola@eksempel.no');
    await user.type(screen.getByLabelText('Telefon'), '91234567');
    await user.type(screen.getByLabelText('Gateadresse'), 'Storgata 10');
    await user.type(screen.getByLabelText('Postnummer (4 siffer)'), '0155');
    await user.type(screen.getByLabelText('Poststed'), 'Oslo');

    await user.click(screen.getByRole('button', { name: 'Fullfør testbestilling' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/ikke lenger tilgjengelig/i);
    expect((screen.getByLabelText('Fullt navn') as HTMLInputElement).value).toBe('Ola Nordmann');
    expect(screen.getByRole('button', { name: 'Fullfør testbestilling' })).toBeInTheDocument();
  });

  it('resolves existing user UID, calls signInAnonymously when unauthenticated, and handles auth failure safely', async () => {
    const existingAuth = {
      authStateReady: vi.fn(async () => undefined),
      currentUser: { uid: 'existing-user-123' },
    } as unknown as Auth;

    expect(await ensureAnonymousUserUid(existingAuth)).toBe('existing-user-123');
    expect(signInAnonymously).not.toHaveBeenCalled();

    const emptyAuth = {
      authStateReady: vi.fn(async () => undefined),
      currentUser: null,
    } as unknown as Auth;
    vi.mocked(signInAnonymously).mockResolvedValueOnce({
      user: { uid: 'anon-uid-456' },
    } as never);

    expect(await resolveCheckoutOwnerUid(emptyAuth, true)).toBe('anon-uid-456');
    expect(signInAnonymously).toHaveBeenCalledTimes(1);

    vi.mocked(signInAnonymously).mockRejectedValueOnce(new Error('auth/operation-not-allowed'));
    await expect(ensureAnonymousUserUid(emptyAuth)).rejects.toThrow(
      /Kunne ikke opprette gjestesesjon/i,
    );

    // Unconfigured Firebase falls back cleanly to LocalOrderRepository & local guest UID
    expect(getOrderRepository()).toBeInstanceOf(LocalOrderRepository);
    const localGuest = await resolveCheckoutOwnerUid(null, false);
    expect(localGuest).toMatch(/^local-guest-/);

    // LocalOrderRepository works cleanly when localStorage throws
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const resilientRepo = new LocalOrderRepository('resilient_key');
    const localOrder = await resilientRepo.create({
      ownerUid: localGuest,
      customer: { name: 'Ola Nordmann', email: 'ola@eksempel.no', phone: '91234567' },
      shippingAddress: { street: 'Storgata 10', postalCode: '0155', city: 'Oslo' },
      items: [{ productId: 'army-sekk', quantity: 1 }],
      paymentProvider: 'test_order',
    });
    expect(await resilientRepo.getById(localOrder.id)).not.toBeNull();
    expect(await resilientRepo.getById('.')).toBeNull();
    expect(await resilientRepo.listByOwner('  ')).toEqual([]);
    setItemSpy.mockRestore();
  });

  it('supports Tab focus trap inside Header mobile menu drawer', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Åpne meny' }));
    const mobileDialog = screen.getByRole('dialog', { name: 'Mobilmeny' });
    expect(document.body.style.overflow).toBe('hidden');

    await user.tab({ shift: true });
    expect(mobileDialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('prevents ProductDetailPage stale product flash when navigating cleanly', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/produkt/army-sekk']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Army sekk', level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Legg i handlekurv' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Legg i handlekurv' }));
    expect(screen.getByText('Lagt i handlekurv')).toBeInTheDocument();
  });
});
