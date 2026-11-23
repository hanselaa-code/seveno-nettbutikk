import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_ALLOWLIST_EMAIL,
  AuthProvider,
  mapFirebaseAuthError,
  useAuth,
  verifyUserIsAdmin,
} from '../../src/context/AuthContext';
import { CatalogProvider, useCatalog } from '../../src/context/CatalogContext';
import { CartProvider } from '../../src/context/CartContext';
import { ValidationError } from '../../src/lib/validators';
import { AdminPage } from '../../src/pages/AdminPage';
import { CategoryPage } from '../../src/pages/CategoryPage';
import { LocalContactRepository } from '../../src/repositories/contactRepository';
import { LocalOrderRepository } from '../../src/repositories/orderRepository';
import {
  LocalProductRepository,
  getProductRepository,
} from '../../src/repositories/productRepository';
import type { IProductRepository } from '../../src/repositories/productRepository';
import { getStarterProducts } from '../../src/repositories/seedCatalog';
import { DEFAULT_PRODUCT_IMAGE } from '../../src/types/domain';
import type { Order, Product } from '../../src/types/domain';

const authMocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  getIdTokenResult: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  return {
    ...actual,
    onAuthStateChanged: authMocks.onAuthStateChanged,
    signInWithEmailAndPassword: authMocks.signInWithEmailAndPassword,
    signInWithPopup: authMocks.signInWithPopup,
    signOut: authMocks.signOut,
    getIdTokenResult: authMocks.getIdTokenResult,
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: authMocks.doc,
    getDoc: authMocks.getDoc,
  };
});

import type { Auth, User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

function AuthConsumerHarness() {
  const authCtx = useAuth();
  return (
    <div>
      <span data-testid="auth-loading">{String(authCtx.loading)}</span>
      <span data-testid="auth-user">{authCtx.user ? authCtx.user.uid : 'null'}</span>
      <span data-testid="auth-admin">{String(authCtx.isAdmin)}</span>
      <span data-testid="auth-available">{String(authCtx.isFirebaseAuthAvailable)}</span>
      <span data-testid="auth-error">{authCtx.error ?? 'none'}</span>
      <button
        type="button"
        onClick={() => {
          void authCtx.signInWithEmail('test@seveno.no', 'Passord123').catch(() => {});
        }}
      >
        DoEmailLogin
      </button>
      <button
        type="button"
        onClick={() => {
          void authCtx.signInWithGoogle().catch(() => {});
        }}
      >
        DoGoogleLogin
      </button>
      <button
        type="button"
        onClick={() => {
          void authCtx.signOut().catch(() => {});
        }}
      >
        DoLogout
      </button>
    </div>
  );
}

function makeFirebaseUser(overrides: Partial<User> = {}): User {
  return {
    uid: 'user-1',
    email: 'kunde@seveno.no',
    displayName: 'Kunde',
    emailVerified: true,
    isAnonymous: false,
    ...overrides,
  } as unknown as User;
}

describe('M4 AuthContext, RBAC & LocalProductRepository', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    authMocks.doc.mockReturnValue({ path: 'admins/user-1' });
    authMocks.getIdTokenResult.mockResolvedValue({ claims: {} });
    authMocks.getDoc.mockResolvedValue({ exists: () => false });
  });

  it('initializes AuthContext synchronously when Firebase is unconfigured and rejects sign-in cleanly', async () => {
    render(
      <AuthProvider>
        <AuthConsumerHarness />
      </AuthProvider>,
    );

    expect(screen.getByTestId('auth-loading')).toHaveTextContent('false');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('null');
    expect(screen.getByTestId('auth-admin')).toHaveTextContent('false');
    expect(screen.getByTestId('auth-available')).toHaveTextContent('false');

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole('button', { name: 'DoEmailLogin' }));
    await waitFor(
      () => {
        expect(screen.getByTestId('auth-error')).toHaveTextContent(
          /Firebase Auth er ikke konfigurert/i,
        );
      },
      { timeout: 3000 },
    );

    await user.click(screen.getByRole('button', { name: 'DoGoogleLogin' }));
    await waitFor(
      () => {
        expect(screen.getByTestId('auth-error')).toHaveTextContent(
          /Firebase Auth er ikke konfigurert/i,
        );
      },
      { timeout: 3000 },
    );
  });

  it('maps Firebase Auth error codes to user-friendly Norwegian messages', () => {
    expect(mapFirebaseAuthError({ code: 'auth/invalid-credential' })).toBe(
      'Feil e-postadresse eller passord.',
    );
    expect(mapFirebaseAuthError({ code: 'auth/wrong-password' })).toBe(
      'Feil e-postadresse eller passord.',
    );
    expect(mapFirebaseAuthError({ code: 'auth/user-not-found' })).toBe(
      'Feil e-postadresse eller passord.',
    );
    expect(mapFirebaseAuthError({ code: 'auth/invalid-email' })).toBe('Ugyldig e-postadresse.');
    expect(mapFirebaseAuthError({ code: 'auth/too-many-requests' })).toMatch(
      /For mange innloggingsforsøk/i,
    );
    expect(mapFirebaseAuthError({ code: 'auth/popup-closed-by-user' })).toBe(
      'Google-innlogging ble avbrutt.',
    );
    expect(mapFirebaseAuthError({ code: 'auth/popup-blocked' })).toMatch(/blokkerte/i);
    expect(mapFirebaseAuthError({ code: 'auth/network-request-failed' })).toMatch(/Nettverksfeil/i);
  });

  it('enforces firestore.rules isAdmin() parity in verifyUserIsAdmin', async () => {
    const fakeDb = {} as Firestore;

    // 1. Custom claim admin === true
    authMocks.getIdTokenResult.mockResolvedValueOnce({ claims: { admin: true } });
    expect(await verifyUserIsAdmin(makeFirebaseUser({ uid: 'claim-admin' }), fakeDb)).toBe(true);

    // 2. Allowlisted email verified vs unverified
    expect(
      await verifyUserIsAdmin(
        makeFirebaseUser({ uid: 'owner-1', email: ADMIN_ALLOWLIST_EMAIL, emailVerified: true }),
        fakeDb,
      ),
    ).toBe(true);

    authMocks.getIdTokenResult.mockResolvedValueOnce({ claims: {} });
    authMocks.getDoc.mockResolvedValueOnce({ exists: () => false });
    expect(
      await verifyUserIsAdmin(
        makeFirebaseUser({ uid: 'owner-unverified', email: ADMIN_ALLOWLIST_EMAIL, emailVerified: false }),
        fakeDb,
      ),
    ).toBe(false);

    // 3. admins/{uid} document exists
    authMocks.getIdTokenResult.mockResolvedValueOnce({ claims: {} });
    authMocks.getDoc.mockResolvedValueOnce({ exists: () => true });
    expect(await verifyUserIsAdmin(makeFirebaseUser({ uid: 'doc-admin' }), fakeDb)).toBe(true);

    // 4. Fail-closed on getDoc error
    authMocks.getIdTokenResult.mockResolvedValueOnce({ claims: {} });
    authMocks.getDoc.mockRejectedValueOnce(new Error('permission-denied'));
    expect(await verifyUserIsAdmin(makeFirebaseUser({ uid: 'err-user' }), fakeDb)).toBe(false);

    // 5. Reject anonymous users even if claims/email look admin-like
    expect(
      await verifyUserIsAdmin(
        makeFirebaseUser({
          uid: 'anon-1',
          isAnonymous: true,
          email: ADMIN_ALLOWLIST_EMAIL,
          emailVerified: true,
        }),
        fakeDb,
      ),
    ).toBe(false);
  });

  it('handles onAuthStateChanged race conditions, signInWithEmail, signInWithGoogle, and signOut', async () => {
    let authCallback: ((user: User | null) => void) | null = null;
    const unsubscribeMock = vi.fn();

    authMocks.onAuthStateChanged.mockImplementation((_auth, cb) => {
      authCallback = cb;
      return unsubscribeMock;
    });

    let resolveSlowAdminDoc: ((value: { exists: () => boolean }) => void) | null = null;
    authMocks.getDoc.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSlowAdminDoc = resolve;
        }),
    );

    const fakeAuth = { name: 'mock-auth' } as unknown as Auth;
    const fakeDb = { name: 'mock-db' } as unknown as Firestore;

    render(
      <AuthProvider authInstance={fakeAuth} dbInstance={fakeDb}>
        <AuthConsumerHarness />
      </AuthProvider>,
    );

    expect(screen.getByTestId('auth-loading')).toHaveTextContent('true');

    // Emit user A, whose admin check is still pending
    act(() => {
      authCallback?.(makeFirebaseUser({ uid: 'race-user', email: 'race@seveno.no' }));
    });

    // Immediately sign out before user A's getDoc resolves
    act(() => {
      authCallback?.(null);
    });

    // Now resolve user A's slow getDoc with exists: true — stale result must NOT override sign-out
    await act(async () => {
      resolveSlowAdminDoc?.({ exists: () => true });
      await Promise.resolve();
    });

    expect(screen.getByTestId('auth-loading')).toHaveTextContent('false');
    expect(screen.getByTestId('auth-user')).toHaveTextContent('null');
    expect(screen.getByTestId('auth-admin')).toHaveTextContent('false');

    // Test signInWithEmail error mapping & success, signInWithGoogle, signOut
    authMocks.signInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/invalid-credential' });
    authMocks.signInWithPopup.mockResolvedValueOnce({ user: makeFirebaseUser() });
    authMocks.signOut.mockResolvedValueOnce(undefined);

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole('button', { name: 'DoEmailLogin' }));
    expect(authMocks.signInWithEmailAndPassword).toHaveBeenCalledWith(
      fakeAuth,
      'test@seveno.no',
      'Passord123',
    );
    await waitFor(
      () => {
        expect(screen.getByTestId('auth-error')).toHaveTextContent(
          'Feil e-postadresse eller passord.',
        );
      },
      { timeout: 3000 },
    );

    await user.click(screen.getByRole('button', { name: 'DoGoogleLogin' }));
    expect(authMocks.signInWithPopup).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'DoLogout' }));
    expect(authMocks.signOut).toHaveBeenCalledWith(fakeAuth);
  });

  it('persists CRUD operations in LocalProductRepository, enforces doc ID guards, and integrates with LocalOrderRepository', async () => {
    const repo = getProductRepository();
    expect(repo).toBeInstanceOf(LocalProductRepository);

    const initialActive = await repo.listActive();
    expect(initialActive).toHaveLength(3);

    const created = await repo.create({
      title: 'Nordisk Linserviett',
      categorySlug: 'seveno-home',
      description: 'Myke linservietter vevet i ubleket nordisk lin for langbord og hverdag.',
      priceNok: 490,
      stock: 20,
      specs: ['Materiale: 100 % lin'],
      active: true,
    });

    expect(created.imageUrl).toBe(DEFAULT_PRODUCT_IMAGE);
    expect(created.categoryName).toBe('Seveno home');
    expect((await repo.listByCategory('seveno-home')).some((p) => p.id === created.id)).toBe(true);

    // Order repository in local mode should resolve the newly created local product
    const localOrderRepo = new LocalOrderRepository('test_m4_orders');
    const createdOrder = await localOrderRepo.create({
      ownerUid: 'guest-local-1',
      customer: { name: 'Kari Nordmann', email: 'kari@example.no', phone: '91234567' },
      shippingAddress: { street: 'Fjordveien 4', postalCode: '5003', city: 'Bergen' },
      items: [{ productId: created.id, quantity: 2 }],
      paymentProvider: 'test_order',
    });
    expect(createdOrder.subtotalNok).toBe(980);
    expect(createdOrder.items[0].title).toBe('Nordisk Linserviett');

    // Deactivate removes from listActive/getBySlug but retains in listAll
    await repo.update(created.id, { active: false });
    expect((await repo.listAll()).some((p) => p.id === created.id)).toBe(true);
    expect((await repo.listActive()).some((p) => p.id === created.id)).toBe(false);
    expect(await repo.getBySlug(created.slug)).toBeNull();

    // normalizeDocId guards
    expect(await repo.getById('')).toBeNull();
    expect(await repo.getById('..')).toBeNull();
    expect(await repo.getBySlug('a/b')).toBeNull();
    await expect(repo.delete('..')).rejects.toThrow(/Ugyldig produkt-ID/i);

    await repo.delete(created.id);
    expect((await repo.listAll()).some((p) => p.id === created.id)).toBe(false);
  });

  it('survives localStorage QuotaExceededError in LocalProductRepository', async () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

    try {
      const repo = new LocalProductRepository('quota_test_products');
      const created = await repo.create({
        title: 'Minneprodukt',
        categorySlug: 'seveno-living',
        description: 'Produkt som lagres trygt i minnet selv om localStorage feiler.',
        priceNok: 750,
        stock: 5,
      });

      const all = await repo.listAll();
      expect(all.some((p) => p.id === created.id)).toBe(true);
    } finally {
      setItemSpy.mockRestore();
    }
  });
});

describe('M4 AdminPage Auth Gates & Storefront CRUD Integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders login gate when unauthenticated and rejects non-admin users', async () => {
    const signInEmailMock = vi.fn().mockRejectedValue(new Error('Feil e-postadresse eller passord.'));
    const signInGoogleMock = vi.fn().mockResolvedValue(undefined);
    const signOutMock = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      <MemoryRouter>
        <AuthProvider
          initialUser={null}
          initialIsAdmin={false}
          onSignInWithEmail={signInEmailMock}
          onSignInWithGoogle={signInGoogleMock}
          onSignOut={signOutMock}
        >
          <AdminPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Administrasjon', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('E-postadresse')).toBeInTheDocument();
    expect(screen.getByLabelText('Passord')).toBeInTheDocument();

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole('button', { name: 'Logg inn' }));
    expect(screen.getByText('Oppgi en gyldig e-postadresse.')).toBeInTheDocument();
    expect(screen.getByText('Oppgi passord.')).toBeInTheDocument();
    expect(signInEmailMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('E-postadresse'), 'admin@seveno.no');
    await user.type(screen.getByLabelText('Passord'), 'feilpass');
    await user.click(screen.getByRole('button', { name: 'Logg inn' }));

    expect(signInEmailMock).toHaveBeenCalledWith('admin@seveno.no', 'feilpass');
    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toHaveTextContent('Feil e-postadresse eller passord.');
      },
      { timeout: 3000 },
    );

    await user.click(screen.getByRole('button', { name: 'Logg inn med Google' }));
    expect(signInGoogleMock).toHaveBeenCalledTimes(1);

    // Non-admin authenticated user sees access denied + Logg ut
    rerender(
      <MemoryRouter>
        <AuthProvider
          initialUser={{
            uid: 'user-regular',
            email: 'kunde@example.no',
            displayName: 'Kunde',
            emailVerified: true,
            isAnonymous: false,
          }}
          initialIsAdmin={false}
          onSignOut={signOutMock}
        >
          <AdminPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Administrasjon', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Ingen administratortilgang/i);
    await user.click(screen.getByRole('button', { name: 'Logg ut' }));
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it(
    'creates, edits, deactivates, reactivates, and deletes a product with immediate storefront CategoryPage sync',
    async () => {
      const productRepo: IProductRepository = new LocalProductRepository('admin_crud_products_test');
      const orderRepo = new LocalOrderRepository('admin_crud_orders_test', productRepo);
      const contactRepo = new LocalContactRepository('admin_crud_contacts_test');

      // Seed an order with 5 items (testing defensive rendering for items[3..4] per M1 Caveat #1)
      const fiveItemOrder: Order = {
        id: 'ord-5-items',
        orderNumber: 'SEV-2026-FIVE0001',
        ownerUid: 'guest-5',
        customer: { name: 'Sunniva Solberg', email: 'sunniva@example.no', phone: '98765432' },
        shippingAddress: { street: 'Bygdøy allé 12', postalCode: '0265', city: 'Oslo' },
        items: [
          { productId: 'army-sekk', title: 'Army sekk', quantity: 1, unitPriceNok: 1890, lineTotalNok: 1890 },
          { productId: 'p2', title: 'Produkt 2', quantity: 1, unitPriceNok: 100, lineTotalNok: 100 },
          { productId: 'p3', title: 'Produkt 3', quantity: 1, unitPriceNok: 200, lineTotalNok: 200 },
          { productId: 'p4', title: 'Produkt 4 (ekstra)', quantity: 2, unitPriceNok: 300, lineTotalNok: 600 },
          { productId: 'p5', title: '', quantity: Number.NaN, unitPriceNok: 0, lineTotalNok: Number.NaN },
        ],
        subtotalNok: 2790,
        shippingNok: 0,
        mvaNok: 558,
        totalNok: 2790,
        paymentProvider: 'klarna',
        paymentReference: 'KLARNA-555',
        paymentStatus: 'pending_provider',
        status: 'confirmed',
        createdAt: '2026-11-22T11:00:00.000Z',
      };
      const orderRepoWithFive = {
        ...orderRepo,
        create: orderRepo.create.bind(orderRepo),
        getById: orderRepo.getById.bind(orderRepo),
        listByOwner: orderRepo.listByOwner.bind(orderRepo),
        listAll: vi.fn().mockResolvedValue([fiveItemOrder]),
      };

      await contactRepo.create({
        name: 'Henrik Holm',
        email: 'henrik@example.no',
        subject: 'Spørsmål om ullpledd',
        message: 'Når kommer nye tekstiler inn på lager i nettbutikken?',
      });

      const adminUser = {
        uid: 'admin-1',
        email: ADMIN_ALLOWLIST_EMAIL,
        displayName: 'Admin',
        emailVerified: true,
        isAnonymous: false,
      };

      render(
        <MemoryRouter initialEntries={['/admin']}>
          <AuthProvider initialUser={adminUser} initialIsAdmin={true}>
            <CatalogProvider productRepository={productRepo}>
              <CartProvider>
                <Routes>
                  <Route
                    path="/admin"
                    element={
                      <AdminPage
                        productRepository={productRepo}
                        orderRepository={orderRepoWithFive}
                        contactRepository={contactRepo}
                      />
                    }
                  />
                  <Route path="/kategori/:categorySlug" element={<CategoryPage />} />
                </Routes>
              </CartProvider>
            </CatalogProvider>
          </AuthProvider>
        </MemoryRouter>,
      );

      const user = userEvent.setup({ delay: null });

      await waitFor(
        () => {
          expect(screen.getByRole('tab', { name: /Produkter \(3\)/i })).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Validation failure should block submission
      await user.click(screen.getByRole('button', { name: 'Lagre produkt' }));
      expect(screen.getByText(/Produkttittel må være mellom/i)).toBeInTheDocument();

      // Fill out form for "Nordisk Ullpledd" in Seveno living
      await user.type(screen.getByLabelText('Tittel'), 'Nordisk Ullpledd');
      expect(screen.getByLabelText('URL-slug')).toHaveValue('nordisk-ullpledd');
      await user.selectOptions(screen.getByLabelText('Kategori'), 'seveno-living');
      await user.type(screen.getByLabelText('Pris (NOK)'), '1290');
      await user.clear(screen.getByLabelText('Antall på lager'));
      await user.type(screen.getByLabelText('Antall på lager'), '15');
      fireEvent.change(screen.getByLabelText('Beskrivelse'), {
        target: {
          value: 'Varmt og slitesterkt pledd i 100 % ren nordisk merinoull for sofakroken.',
        },
      });
      fireEvent.change(screen.getByLabelText('Spesifikasjoner (én per linje)'), {
        target: {
          value: 'Materiale: 100 % merinoull\nMål: 140 × 200 cm',
        },
      });

      await user.click(screen.getByRole('button', { name: 'Lagre produkt' }));

      await waitFor(
        () => {
          expect(screen.getByRole('status')).toHaveTextContent(
            'Produktet er lagret og publisert i butikken.',
          );
        },
        { timeout: 3000 },
      );

      // Verify stored in backend repository and reflected in desktop Admin table
      const desktopList = screen.getByTestId('admin-products-desktop');
      expect(within(desktopList).getByText('Nordisk Ullpledd')).toBeInTheDocument();
      const persisted = await productRepo.getBySlug('nordisk-ullpledd');
      expect(persisted).not.toBeNull();
      expect(persisted?.imageUrl).toBe(DEFAULT_PRODUCT_IMAGE);

      // Edit the newly created product
      const ullpleddRow = within(desktopList).getByText('Nordisk Ullpledd').closest('tr');
      expect(ullpleddRow).not.toBeNull();
      await user.click(within(ullpleddRow!).getByRole('button', { name: 'Rediger' }));
      expect(screen.getByRole('heading', { name: 'Rediger produkt', level: 2 })).toBeInTheDocument();

      await user.clear(screen.getByLabelText('Pris (NOK)'));
      await user.type(screen.getByLabelText('Pris (NOK)'), '1390');
      await user.click(screen.getByRole('button', { name: 'Oppdater produkt' }));

      await waitFor(
        () => {
          expect(within(desktopList).getByText('1 390 kr')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Deactivate keeps product visible in Admin listAll() while hiding from active catalog
      const updatedRow = within(desktopList).getByText('Nordisk Ullpledd').closest('tr');
      await user.click(within(updatedRow!).getByRole('button', { name: 'Deaktiver' }));

      await waitFor(
        () => {
          const rowAfterDeactivate = within(desktopList).getByText('Nordisk Ullpledd').closest('tr');
          expect(within(rowAfterDeactivate!).getByText('Deaktivert')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
      expect(await productRepo.getBySlug('nordisk-ullpledd')).toBeNull();

      // Reactivate brings it back to storefront
      const rowToReactivate = within(desktopList).getByText('Nordisk Ullpledd').closest('tr');
      await user.click(within(rowToReactivate!).getByRole('button', { name: 'Aktiver' }));

      await waitFor(
        () => {
          const rowAfterReactivate = within(desktopList).getByText('Nordisk Ullpledd').closest('tr');
          expect(within(rowAfterReactivate!).getByText('Aktiv')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Check Bestillinger & Henvendelser tabs
      await user.click(screen.getByRole('tab', { name: /Bestillinger \(1\)/i }));
      expect(screen.getByText('SEV-2026-FIVE0001')).toBeInTheDocument();
      expect(screen.getByText(/Produkt 4 \(ekstra\)/i)).toBeInTheDocument();
      expect(screen.getByText(/0 × p5/i)).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: /Henvendelser \(1\)/i }));
      expect(screen.getByText('Spørsmål om ullpledd')).toBeInTheDocument();
      expect(screen.getByText(/Henrik Holm/i)).toBeInTheDocument();

      // Switch back to Produkter and test Delete
      await user.click(screen.getByRole('tab', { name: /Produkter/i }));
      const rowToDelete = within(screen.getByTestId('admin-products-desktop'))
        .getByText('Nordisk Ullpledd')
        .closest('tr');
      await user.click(within(rowToDelete!).getByRole('button', { name: 'Slett' }));

      await waitFor(
        () => {
          expect(
            within(screen.getByTestId('admin-products-desktop')).queryByText('Nordisk Ullpledd'),
          ).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    },
    15_000,
  );

  it(
    'displays newly created admin product in storefront CategoryPage immediately after refreshCatalog',
    async () => {
      const productRepo = new LocalProductRepository('admin_storefront_sync_test');
      const adminUser = {
        uid: 'admin-sync',
        email: ADMIN_ALLOWLIST_EMAIL,
        displayName: 'Admin',
        emailVerified: true,
        isAnonymous: false,
      };

      render(
        <MemoryRouter initialEntries={['/admin']}>
          <AuthProvider initialUser={adminUser} initialIsAdmin={true}>
            <CatalogProvider productRepository={productRepo}>
              <CartProvider>
                <nav>
                  <Link to="/kategori/seveno-living">Gå til Seveno living</Link>
                </nav>
                <Routes>
                  <Route path="/admin" element={<AdminPage productRepository={productRepo} />} />
                  <Route path="/kategori/:categorySlug" element={<CategoryPage />} />
                </Routes>
              </CartProvider>
            </CatalogProvider>
          </AuthProvider>
        </MemoryRouter>,
      );

      const user = userEvent.setup({ delay: null });

      await waitFor(
        () => {
          expect(screen.getByLabelText('Tittel')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      await user.type(screen.getByLabelText('Tittel'), 'Nordisk Ullpledd');
      await user.selectOptions(screen.getByLabelText('Kategori'), 'seveno-living');
      await user.type(screen.getByLabelText('Pris (NOK)'), '1290');
      fireEvent.change(screen.getByLabelText('Beskrivelse'), {
        target: { value: 'Eksklusivt ullpledd for nordisk stue og hytte.' },
      });
      await user.click(screen.getByRole('button', { name: 'Lagre produkt' }));

      await waitFor(
        () => {
          expect(screen.getByRole('status')).toHaveTextContent(
            'Produktet er lagret og publisert i butikken.',
          );
        },
        { timeout: 3000 },
      );

      // Navigate directly within the same CatalogProvider to /kategori/seveno-living
      await user.click(screen.getByRole('link', { name: 'Gå til Seveno living' }));

      await waitFor(
        () => {
          expect(screen.getByText('Nordisk Ullpledd')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
      expect(screen.getByText('1 290 kr')).toBeInTheDocument();
      const productImg = screen.getByRole('img', { name: 'Nordisk Ullpledd' });
      expect(productImg).toHaveAttribute('src', DEFAULT_PRODUCT_IMAGE);
    },
    15_000,
  );
});

function CatalogRegressionProbe() {
  const { products, loading, refreshCatalog } = useCatalog();
  return (
    <div>
      <span data-testid="catalog-loading">{String(loading)}</span>
      <span data-testid="catalog-count">{products.length}</span>
      <button type="button" onClick={() => void refreshCatalog()}>
        Oppdater katalog
      </button>
    </div>
  );
}

describe('M4 Iteration 2 Regression & Hardening Tests', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('rejects ordering a deleted starter product in LocalOrderRepository', async () => {
    const productRepo = getProductRepository();
    expect(await productRepo.getById('army-sekk')).not.toBeNull();

    await productRepo.delete('army-sekk');
    expect(await productRepo.getById('army-sekk')).toBeNull();

    const localOrderRepo = new LocalOrderRepository('deleted_starter_order_test');
    await expect(
      localOrderRepo.create({
        ownerUid: 'guest-deleted-1',
        customer: { name: 'Ola Nordmann', email: 'ola@example.no', phone: '91234567' },
        shippingAddress: { street: 'Storgata 10', postalCode: '0155', city: 'Oslo' },
        items: [{ productId: 'army-sekk', quantity: 1 }],
        paymentProvider: 'test_order',
      }),
    ).rejects.toThrow(/ikke tilgjengelig/i);
  });

  it('CatalogProvider with LocalProductRepository preserves empty catalog after deleting all products', async () => {
    const localRepo = new LocalProductRepository('catalog_empty_after_delete');
    const all = await localRepo.listAll();
    expect(all).toHaveLength(3);
    for (const product of all) {
      await localRepo.delete(product.id);
    }
    expect(await localRepo.listAll()).toHaveLength(0);

    const user = userEvent.setup({ delay: null });
    render(
      <CatalogProvider productRepository={localRepo}>
        <CatalogRegressionProbe />
      </CatalogProvider>,
    );

    expect(screen.getByTestId('catalog-loading')).toHaveTextContent('false');
    expect(screen.getByTestId('catalog-count')).toHaveTextContent('0');

    await user.click(screen.getByRole('button', { name: 'Oppdater katalog' }));
    await waitFor(
      () => {
        expect(screen.getByTestId('catalog-count')).toHaveTextContent('0');
      },
      { timeout: 3000 },
    );
    expect(await localRepo.listAll()).toHaveLength(0);
  });

  it('CatalogProvider with LocalProductRepository hides all products when all products are deactivated', async () => {
    const localRepo = new LocalProductRepository('catalog_all_deactivated');
    const all = await localRepo.listAll();
    for (const product of all) {
      await localRepo.update(product.id, { active: false });
    }

    const user = userEvent.setup({ delay: null });
    render(
      <CatalogProvider productRepository={localRepo}>
        <CatalogRegressionProbe />
      </CatalogProvider>,
    );

    expect(screen.getByTestId('catalog-loading')).toHaveTextContent('false');
    expect(screen.getByTestId('catalog-count')).toHaveTextContent('0');

    await user.click(screen.getByRole('button', { name: 'Oppdater katalog' }));
    await waitFor(
      () => {
        expect(screen.getByTestId('catalog-count')).toHaveTextContent('0');
      },
      { timeout: 3000 },
    );
    expect(await localRepo.listAll()).toHaveLength(3);
  });

  it('enforces slug uniqueness on create/update and filters malformed localStorage products', async () => {
    const storageKey = 'slug_uniqueness_and_validation_test';
    const repo = new LocalProductRepository(storageKey);

    const p1 = await repo.create({
      title: 'Produkt En',
      slug: 'unik-slug',
      categorySlug: 'seveno-living',
      description: 'Gyldig produktbeskrivelse for det første produktet.',
      priceNok: 500,
      stock: 5,
    });

    await expect(
      repo.create({
        title: 'Produkt To',
        slug: 'unik-slug',
        categorySlug: 'seveno-living',
        description: 'Gyldig produktbeskrivelse for det andre produktet.',
        priceNok: 600,
        stock: 5,
      }),
    ).rejects.toThrow(ValidationError);

    const p2 = await repo.create({
      title: 'Produkt To',
      slug: 'annen-slug',
      categorySlug: 'seveno-living',
      description: 'Gyldig produktbeskrivelse for det andre produktet.',
      priceNok: 600,
      stock: 5,
    });

    await expect(repo.update(p2.id, { slug: 'unik-slug' })).rejects.toThrow(ValidationError);
    expect((await repo.update(p1.id, { title: 'Produkt En Oppdatert' })).slug).toBe('unik-slug');

    // Malformed localStorage entries missing description, imageUrl, or string[] specs are filtered out
    window.localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: 'bad-missing-specs',
          slug: 'bad-missing-specs',
          title: 'Ugyldig',
          categorySlug: 'seveno-home',
          description: 'Mangler specs array',
          priceNok: 100,
          stock: 1,
          imageUrl: DEFAULT_PRODUCT_IMAGE,
          active: true,
        },
        {
          id: 'bad-non-string-spec',
          slug: 'bad-non-string-spec',
          title: 'Ugyldig 2',
          categorySlug: 'seveno-home',
          description: 'Specs inneholder tall',
          priceNok: 100,
          stock: 1,
          imageUrl: DEFAULT_PRODUCT_IMAGE,
          specs: [123],
          active: true,
        },
        p1,
      ]),
    );

    const freshRepo = new LocalProductRepository(storageKey);
    const loaded = await freshRepo.listAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(p1.id);
  });

  it('AdminPage shows inactive confirmation copy, blocks duplicate same-tick auth submits, and ignores stale dashboard fetches', async () => {
    const productRepo = new LocalProductRepository('admin_inactive_copy_test');
    const user = userEvent.setup({ delay: null });

    let resolveEmailLogin!: () => void;
    const signInEmailMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveEmailLogin = resolve;
        }),
    );
    const signInGoogleMock = vi.fn(
      () =>
        new Promise<void>(() => {
          // pending
        }),
    );

    const { unmount } = render(
      <MemoryRouter>
        <AuthProvider
          initialUser={null}
          initialIsAdmin={false}
          onSignInWithEmail={signInEmailMock}
          onSignInWithGoogle={signInGoogleMock}
        >
          <AdminPage productRepository={productRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('E-postadresse'), 'admin@seveno.no');
    await user.type(screen.getByLabelText('Passord'), 'Hemmelig123');

    const form = screen.getByRole('button', { name: 'Logg inn' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole('button', { name: 'Logg inn med Google' }));

    expect(signInEmailMock).toHaveBeenCalledTimes(1);
    expect(signInGoogleMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveEmailLogin();
      await Promise.resolve();
    });
    unmount();

    // Test inactive product confirmation message & stale dashboard fetch guard
    let resolveStaleProducts!: (value: Product[]) => void;
    const slowProductRepo: IProductRepository = {
      ...productRepo,
      listAll: vi.fn(
        () =>
          new Promise<Product[]>((resolve) => {
            resolveStaleProducts = resolve;
          }),
      ),
      listActive: productRepo.listActive.bind(productRepo),
      listByCategory: productRepo.listByCategory.bind(productRepo),
      getById: productRepo.getById.bind(productRepo),
      getBySlug: productRepo.getBySlug.bind(productRepo),
      create: productRepo.create.bind(productRepo),
      update: productRepo.update.bind(productRepo),
      delete: productRepo.delete.bind(productRepo),
    };

    const adminUser = {
      uid: 'admin-copy',
      email: ADMIN_ALLOWLIST_EMAIL,
      displayName: 'Admin',
      emailVerified: true,
      isAnonymous: false,
    };

    const { rerender } = render(
      <MemoryRouter>
        <AuthProvider initialUser={adminUser} initialIsAdmin={true}>
          <AdminPage productRepository={slowProductRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    // Sign out while dashboard listAll() is still pending
    rerender(
      <MemoryRouter>
        <AuthProvider initialUser={null} initialIsAdmin={false}>
          <AdminPage productRepository={slowProductRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    // Resolve stale fetch; AdminPage should stay on login gate cleanly without throwing/leaking
    await act(async () => {
      resolveStaleProducts(await productRepo.listAll());
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Administratorinnlogging' })).toBeInTheDocument();

    // Re-authenticate with fast repo and save an inactive product
    rerender(
      <MemoryRouter>
        <AuthProvider initialUser={adminUser} initialIsAdmin={true}>
          <AdminPage productRepository={productRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(screen.getByLabelText('Tittel')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    await user.type(screen.getByLabelText('Tittel'), 'Skjult Vare');
    await user.type(screen.getByLabelText('Pris (NOK)'), '890');
    fireEvent.change(screen.getByLabelText('Beskrivelse'), {
      target: { value: 'Et utkastprodukt som ikke skal publiseres ennå.' },
    });
    await user.click(screen.getByLabelText('Aktiv i nettbutikken'));
    await user.click(screen.getByRole('button', { name: 'Lagre produkt' }));

    await waitFor(
      () => {
        expect(screen.getByRole('status')).toHaveTextContent(
          'Produktet er lagret som deaktivert (skjult fra butikken).',
        );
      },
      { timeout: 3000 },
    );
  });

  it('AdminPage prevents in-flight loadDashboardData from rendering uncommitted products while create() is pending', async () => {
    const baseRepo = new LocalProductRepository('admin_race_guard_test');
    const starter = await baseRepo.listAll();
    const user = userEvent.setup({ delay: null });

    let resolveInitialList!: (value: Product[]) => void;
    let resolveCreate!: (value: Product) => void;
    let createdCommitted = false;

    const raceProduct: Product = {
      id: 'race-product-1',
      slug: 'race-produkt',
      title: 'Race Testprodukt',
      categorySlug: 'seveno-living',
      categoryName: 'Seveno living',
      description: 'Produkt som tester at in-flight dashboard fetch ikke lekker uforpliktet write.',
      priceNok: 1490,
      stock: 5,
      imageUrl: DEFAULT_PRODUCT_IMAGE,
      specs: [],
      active: true,
      createdAt: '2026-11-22T20:00:00.000Z',
      updatedAt: '2026-11-22T20:00:00.000Z',
    };

    let listCallCount = 0;
    const racingRepo: IProductRepository = {
      listAll: vi.fn(() => {
        listCallCount += 1;
        if (listCallCount === 1) {
          return new Promise<Product[]>((resolve) => {
            resolveInitialList = resolve;
          });
        }
        return Promise.resolve(createdCommitted ? [...starter, raceProduct] : starter);
      }),
      listActive: () => Promise.resolve(createdCommitted ? [...starter, raceProduct] : starter),
      listByCategory: baseRepo.listByCategory.bind(baseRepo),
      getById: baseRepo.getById.bind(baseRepo),
      getBySlug: baseRepo.getBySlug.bind(baseRepo),
      create: vi.fn(
        () =>
          new Promise<Product>((resolve) => {
            resolveCreate = (prod) => {
              createdCommitted = true;
              resolve(prod);
            };
          }),
      ),
      update: baseRepo.update.bind(baseRepo),
      delete: baseRepo.delete.bind(baseRepo),
    };

    const adminUser = {
      uid: 'admin-race',
      email: ADMIN_ALLOWLIST_EMAIL,
      displayName: 'Admin',
      emailVerified: true,
      isAnonymous: false,
    };

    render(
      <MemoryRouter>
        <AuthProvider initialUser={adminUser} initialIsAdmin={true}>
          <AdminPage productRepository={racingRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Tittel'), 'Race Testprodukt');
    await user.type(screen.getByLabelText('Pris (NOK)'), '1490');
    fireEvent.change(screen.getByLabelText('Beskrivelse'), {
      target: {
        value: 'Produkt som tester at in-flight dashboard fetch ikke lekker uforpliktet write.',
      },
    });
    await user.click(screen.getByRole('button', { name: 'Lagre produkt' }));

    expect(screen.getByRole('button', { name: 'Lagrer ...' })).toBeDisabled();

    // Initial loadDashboardData resolves while create() is still pending,
    // returning the uncommitted product from local SDK cache — must be ignored!
    await act(async () => {
      resolveInitialList([...starter, raceProduct]);
      await Promise.resolve();
    });

    expect(screen.queryByText('Race Testprodukt')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lagrer ...' })).toBeDisabled();

    // Now commit create() -> refreshed list renders Race Testprodukt and resets form
    await act(async () => {
      resolveCreate(raceProduct);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getAllByText('Race Testprodukt').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByRole('button', { name: 'Lagre produkt' })).toBeEnabled();
  });

  it('AdminPage prevents slower concurrent toggleActive(A) listAll() from resurrecting deleted product B', async () => {
    const baseRepo = new LocalProductRepository('admin_concurrent_row_mutations_test');
    const prodA: Product = {
      id: 'prod-a',
      slug: 'produkt-a',
      title: 'Produkt A',
      categorySlug: 'seveno-living',
      categoryName: 'Seveno living',
      description: 'Beskrivelse for produkt A med tilstrekkelig lengde.',
      priceNok: 500,
      stock: 10,
      imageUrl: DEFAULT_PRODUCT_IMAGE,
      specs: [],
      active: true,
      createdAt: '2026-11-22T20:00:00.000Z',
      updatedAt: '2026-11-22T20:00:00.000Z',
    };
    const prodB: Product = {
      id: 'prod-b',
      slug: 'produkt-b',
      title: 'Produkt B',
      categorySlug: 'seveno-home',
      categoryName: 'Seveno home',
      description: 'Beskrivelse for produkt B med tilstrekkelig lengde.',
      priceNok: 700,
      stock: 5,
      imageUrl: DEFAULT_PRODUCT_IMAGE,
      specs: [],
      active: true,
      createdAt: '2026-11-22T20:00:00.000Z',
      updatedAt: '2026-11-22T20:00:00.000Z',
    };
    const prodADeactivated: Product = { ...prodA, active: false };

    let listCallCount = 0;
    let resolveToggleList!: (value: Product[]) => void;

    const concurrentRepo: IProductRepository = {
      listAll: vi.fn(() => {
        listCallCount += 1;
        if (listCallCount === 1) {
          return Promise.resolve([prodA, prodB]);
        }
        if (listCallCount === 2) {
          // Slower listAll() from toggleActive(A)
          return new Promise<Product[]>((resolve) => {
            resolveToggleList = resolve;
          });
        }
        // Fast listAll() from delete(B)
        return Promise.resolve([prodADeactivated]);
      }),
      listActive: () => Promise.resolve([prodADeactivated]),
      listByCategory: baseRepo.listByCategory.bind(baseRepo),
      getById: baseRepo.getById.bind(baseRepo),
      getBySlug: baseRepo.getBySlug.bind(baseRepo),
      create: baseRepo.create.bind(baseRepo),
      update: vi.fn().mockResolvedValue(prodADeactivated),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const adminUser = {
      uid: 'admin-concurrent',
      email: ADMIN_ALLOWLIST_EMAIL,
      displayName: 'Admin',
      emailVerified: true,
      isAnonymous: false,
    };

    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter>
        <AuthProvider initialUser={adminUser} initialIsAdmin={true}>
          <AdminPage productRepository={concurrentRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Produkter \(2\)/i })).toBeInTheDocument();
    });

    const desktopList = screen.getByTestId('admin-products-desktop');
    const rowA = within(desktopList).getByText('Produkt A').closest('tr')!;
    const rowB = within(desktopList).getByText('Produkt B').closest('tr')!;

    // Trigger toggleActive(A) (slow listAll) then immediately delete(B) (fast listAll)
    await user.click(within(rowA).getByRole('button', { name: 'Deaktiver' }));
    await user.click(within(rowB).getByRole('button', { name: 'Slett' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Produkter \(1\)/i })).toBeInTheDocument();
    });
    expect(within(desktopList).queryByText('Produkt B')).not.toBeInTheDocument();

    // Now resolve toggleActive(A)'s stale slower listAll() with [prodADeactivated, prodB]
    await act(async () => {
      resolveToggleList([prodADeactivated, prodB]);
      await Promise.resolve();
    });

    expect(screen.getByRole('tab', { name: /Produkter \(1\)/i })).toBeInTheDocument();
    expect(within(desktopList).queryByText('Produkt B')).not.toBeInTheDocument();
  });

  it('AdminPage prevents in-flight create() refresh from Session 1 overwriting Session 2 after signOut -> signIn', async () => {
    const baseRepo = new LocalProductRepository('admin_session_epoch_test');
    const baseProduct: Product = {
      id: 'base-prod',
      slug: 'baseprodukt',
      title: 'Baseprodukt',
      categorySlug: 'seveno-living',
      categoryName: 'Seveno living',
      description: 'Grunnleggende produkt i katalogen for sesjonstest.',
      priceNok: 990,
      stock: 8,
      imageUrl: DEFAULT_PRODUCT_IMAGE,
      specs: [],
      active: true,
      createdAt: '2026-11-22T20:00:00.000Z',
      updatedAt: '2026-11-22T20:00:00.000Z',
    };
    const ghostProduct: Product = {
      ...baseProduct,
      id: 'ghost-prod',
      slug: 'spokelsesprodukt',
      title: 'Spøkelsesprodukt',
    };

    let listCallCount = 0;
    let resolveSession1CreateList!: (value: Product[]) => void;

    const epochRepo: IProductRepository = {
      listAll: vi.fn(() => {
        listCallCount += 1;
        if (listCallCount === 1) {
          return Promise.resolve([baseProduct]);
        }
        if (listCallCount === 2) {
          // Session 1 create() post-write listAll() hangs across signOut -> signIn
          return new Promise<Product[]>((resolve) => {
            resolveSession1CreateList = resolve;
          });
        }
        // Session 2 loadDashboardData()
        return Promise.resolve([baseProduct]);
      }),
      listActive: () => Promise.resolve([baseProduct]),
      listByCategory: baseRepo.listByCategory.bind(baseRepo),
      getById: baseRepo.getById.bind(baseRepo),
      getBySlug: baseRepo.getBySlug.bind(baseRepo),
      create: vi.fn().mockResolvedValue(ghostProduct),
      update: baseRepo.update.bind(baseRepo),
      delete: baseRepo.delete.bind(baseRepo),
    };

    const admin1 = {
      uid: 'admin-session-1',
      email: ADMIN_ALLOWLIST_EMAIL,
      displayName: 'Admin 1',
      emailVerified: true,
      isAnonymous: false,
    };
    const admin2 = {
      uid: 'admin-session-2',
      email: ADMIN_ALLOWLIST_EMAIL,
      displayName: 'Admin 2',
      emailVerified: true,
      isAnonymous: false,
    };

    const user = userEvent.setup({ delay: null });
    const { rerender } = render(
      <MemoryRouter>
        <AuthProvider initialUser={admin1} initialIsAdmin={true}>
          <AdminPage productRepository={epochRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Produkter \(1\)/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Tittel'), 'Spøkelsesprodukt');
    await user.type(screen.getByLabelText('Pris (NOK)'), '990');
    fireEvent.change(screen.getByLabelText('Beskrivelse'), {
      target: { value: 'Produkt opprettet rett før utlogging i sesjon 1.' },
    });
    await user.click(screen.getByRole('button', { name: 'Lagre produkt' }));

    await waitFor(() => {
      expect(epochRepo.create).toHaveBeenCalledTimes(1);
    });

    // Sign out -> Sign in as Session 2 while Session 1's listAll() is still pending
    rerender(
      <MemoryRouter>
        <AuthProvider initialUser={null} initialIsAdmin={false}>
          <AdminPage productRepository={epochRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <AuthProvider initialUser={admin2} initialIsAdmin={true}>
          <AdminPage productRepository={epochRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Produkter \(1\)/i })).toBeInTheDocument();
    });

    // Resolve Session 1's stale listAll()
    await act(async () => {
      resolveSession1CreateList([baseProduct, ghostProduct]);
      await Promise.resolve();
    });

    expect(screen.getByRole('tab', { name: /Produkter \(1\)/i })).toBeInTheDocument();
    expect(screen.queryByText('Spøkelsesprodukt')).not.toBeInTheDocument();
    expect(screen.queryByText('Produktet er lagret og publisert i butikken.')).not.toBeInTheDocument();
  });

  it('AdminPage recovers existing catalog products when create() fails while initial loadDashboardData() is pending', async () => {
    const baseRepo = new LocalProductRepository('admin_failed_create_recovery_test');
    const existingProduct: Product = {
      id: 'existing-prod',
      slug: 'eksisterende-vare',
      title: 'Eksisterende Vare',
      categorySlug: 'seveno-home',
      categoryName: 'Seveno home',
      description: 'Eksisterende produkt som ikke skal forsvinne ved feilet opprettelse.',
      priceNok: 1290,
      stock: 4,
      imageUrl: DEFAULT_PRODUCT_IMAGE,
      specs: [],
      active: true,
      createdAt: '2026-11-22T20:00:00.000Z',
      updatedAt: '2026-11-22T20:00:00.000Z',
    };

    let listCallCount = 0;
    let resolveInitialList!: (value: Product[]) => void;

    const recoveryRepo: IProductRepository = {
      listAll: vi.fn(() => {
        listCallCount += 1;
        if (listCallCount === 1) {
          return new Promise<Product[]>((resolve) => {
            resolveInitialList = resolve;
          });
        }
        return Promise.resolve([existingProduct]);
      }),
      listActive: () => Promise.resolve([existingProduct]),
      listByCategory: baseRepo.listByCategory.bind(baseRepo),
      getById: baseRepo.getById.bind(baseRepo),
      getBySlug: baseRepo.getBySlug.bind(baseRepo),
      create: vi.fn().mockRejectedValue(new Error('Permission denied')),
      update: baseRepo.update.bind(baseRepo),
      delete: baseRepo.delete.bind(baseRepo),
    };

    const adminUser = {
      uid: 'admin-recovery',
      email: ADMIN_ALLOWLIST_EMAIL,
      displayName: 'Admin',
      emailVerified: true,
      isAnonymous: false,
    };

    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter>
        <AuthProvider initialUser={adminUser} initialIsAdmin={true}>
          <AdminPage productRepository={recoveryRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    // Submit create() before initial loadDashboardData() settles
    await user.type(screen.getByLabelText('Tittel'), 'Feilende Produkt');
    await user.type(screen.getByLabelText('Pris (NOK)'), '499');
    fireEvent.change(screen.getByLabelText('Beskrivelse'), {
      target: { value: 'Et produkt som blir avvist av backend-regler.' },
    });
    await user.click(screen.getByRole('button', { name: 'Lagre produkt' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Permission denied');
    });

    // Resolve slow initial listAll() too; recovery fetch ensures existing product is visible
    await act(async () => {
      resolveInitialList([existingProduct]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Produkter \(1\)/i })).toBeInTheDocument();
    });
    const desktopList = screen.getByTestId('admin-products-desktop');
    expect(within(desktopList).getByText('Eksisterende Vare')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Permission denied');
  });

  it('AdminPage resets form save lock on session change and prevents stale Session 1 finally from unlocking Session 2 save (Probe 2e-attack)', async () => {
    const baseRepo = new LocalProductRepository('admin_probe_2e_attack_test');
    const baseProduct: Product = {
      id: 'base-prod-2e',
      slug: 'baseprodukt-2e',
      title: 'Baseprodukt 2e',
      categorySlug: 'seveno-living',
      categoryName: 'Seveno living',
      description: 'Grunnleggende produkt i katalogen for 2e-attack regresjonstest.',
      priceNok: 990,
      stock: 8,
      imageUrl: DEFAULT_PRODUCT_IMAGE,
      specs: [],
      active: true,
      createdAt: '2026-11-22T20:00:00.000Z',
      updatedAt: '2026-11-22T20:00:00.000Z',
    };
    const session2Product: Product = {
      ...baseProduct,
      id: 'session2-prod',
      slug: 'sesjon-2-produkt',
      title: 'Sesjon 2 Produkt',
      priceNok: 890,
    };

    let createCallCount = 0;
    let rejectCreate1!: (err: Error) => void;
    let resolveCreate2!: (value: Product) => void;
    let session2Committed = false;

    const attackRepo: IProductRepository = {
      listAll: vi.fn(() =>
        Promise.resolve(session2Committed ? [baseProduct, session2Product] : [baseProduct]),
      ),
      listActive: () =>
        Promise.resolve(session2Committed ? [baseProduct, session2Product] : [baseProduct]),
      listByCategory: baseRepo.listByCategory.bind(baseRepo),
      getById: baseRepo.getById.bind(baseRepo),
      getBySlug: baseRepo.getBySlug.bind(baseRepo),
      create: vi.fn(() => {
        createCallCount += 1;
        if (createCallCount === 1) {
          return new Promise<Product>((_resolve, reject) => {
            rejectCreate1 = reject;
          });
        }
        return new Promise<Product>((resolve) => {
          resolveCreate2 = (prod) => {
            session2Committed = true;
            resolve(prod);
          };
        });
      }),
      update: baseRepo.update.bind(baseRepo),
      delete: baseRepo.delete.bind(baseRepo),
    };

    const admin1 = {
      uid: 'admin-2e-1',
      email: ADMIN_ALLOWLIST_EMAIL,
      displayName: 'Admin 1',
      emailVerified: true,
      isAnonymous: false,
    };
    const admin2 = {
      uid: 'admin-2e-2',
      email: ADMIN_ALLOWLIST_EMAIL,
      displayName: 'Admin 2',
      emailVerified: true,
      isAnonymous: false,
    };

    const user = userEvent.setup({ delay: null });
    const { rerender } = render(
      <MemoryRouter>
        <AuthProvider initialUser={admin1} initialIsAdmin={true}>
          <AdminPage productRepository={attackRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Produkter \(1\)/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Tittel'), 'Hengende Produkt');
    await user.type(screen.getByLabelText('Pris (NOK)'), '790');
    fireEvent.change(screen.getByLabelText('Beskrivelse'), {
      target: { value: 'Produkt fra sesjon 1 der create() fortsatt henger.' },
    });
    await user.click(screen.getByRole('button', { name: 'Lagre produkt' }));
    expect(screen.getByRole('button', { name: 'Lagrer ...' })).toBeDisabled();

    // Sign out -> Sign in as Session 2 BEFORE Session 1's create() settles
    rerender(
      <MemoryRouter>
        <AuthProvider initialUser={null} initialIsAdmin={false}>
          <AdminPage productRepository={attackRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <AuthProvider initialUser={admin2} initialIsAdmin={true}>
          <AdminPage productRepository={attackRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Produkter \(1\)/i })).toBeInTheDocument();
    });

    // Session 2 submit button MUST be enabled and stale form fields cleared
    expect(screen.getByRole('button', { name: 'Lagre produkt' })).toBeEnabled();
    expect(screen.getByLabelText('Tittel')).toHaveValue('');

    // Start Session 2 save
    await user.type(screen.getByLabelText('Tittel'), 'Sesjon 2 Produkt');
    await user.type(screen.getByLabelText('Pris (NOK)'), '890');
    fireEvent.change(screen.getByLabelText('Beskrivelse'), {
      target: { value: 'Gyldig produkt opprettet i sesjon 2.' },
    });
    await user.click(screen.getByRole('button', { name: 'Lagre produkt' }));
    expect(screen.getByRole('button', { name: 'Lagrer ...' })).toBeDisabled();

    // Now Session 1's hanging create() fails late — MUST NOT unlock Session 2's active save
    await act(async () => {
      rejectCreate1(new Error('Late Session 1 error'));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Lagrer ...' })).toBeDisabled();
    expect(screen.queryByText('Late Session 1 error')).not.toBeInTheDocument();

    // Now Session 2 create() succeeds cleanly
    await act(async () => {
      resolveCreate2(session2Product);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Produkter \(2\)/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Lagre produkt' })).toBeEnabled();
    expect(screen.queryByText('Hengende Produkt')).not.toBeInTheDocument();
  });

  it('AdminPage preserves Produkt B edit form when deleting Produkt A while Produkt A was previously being edited (Probe 2h-2)', async () => {
    const baseRepo = new LocalProductRepository('admin_probe_2h2_test');
    const prodA: Product = {
      id: 'prod-a-2h2',
      slug: 'produkt-a-2h2',
      title: 'Produkt A',
      categorySlug: 'seveno-living',
      categoryName: 'Seveno living',
      description: 'Beskrivelse for produkt A i 2h-2 regresjonstest.',
      priceNok: 500,
      stock: 10,
      imageUrl: DEFAULT_PRODUCT_IMAGE,
      specs: [],
      active: true,
      createdAt: '2026-11-22T20:00:00.000Z',
      updatedAt: '2026-11-22T20:00:00.000Z',
    };
    const prodB: Product = {
      id: 'prod-b-2h2',
      slug: 'produkt-b-2h2',
      title: 'Produkt B',
      categorySlug: 'seveno-home',
      categoryName: 'Seveno home',
      description: 'Beskrivelse for produkt B i 2h-2 regresjonstest.',
      priceNok: 750,
      stock: 4,
      imageUrl: DEFAULT_PRODUCT_IMAGE,
      specs: [],
      active: true,
      createdAt: '2026-11-22T20:00:00.000Z',
      updatedAt: '2026-11-22T20:00:00.000Z',
    };

    let deletedA = false;
    let resolveDeleteA!: () => void;

    const deleteRaceRepo: IProductRepository = {
      listAll: vi.fn(() => Promise.resolve(deletedA ? [prodB] : [prodA, prodB])),
      listActive: () => Promise.resolve(deletedA ? [prodB] : [prodA, prodB]),
      listByCategory: baseRepo.listByCategory.bind(baseRepo),
      getById: baseRepo.getById.bind(baseRepo),
      getBySlug: baseRepo.getBySlug.bind(baseRepo),
      create: baseRepo.create.bind(baseRepo),
      update: baseRepo.update.bind(baseRepo),
      delete: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveDeleteA = () => {
              deletedA = true;
              resolve();
            };
          }),
      ),
    };

    const adminUser = {
      uid: 'admin-2h2',
      email: ADMIN_ALLOWLIST_EMAIL,
      displayName: 'Admin',
      emailVerified: true,
      isAnonymous: false,
    };

    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter>
        <AuthProvider initialUser={adminUser} initialIsAdmin={true}>
          <AdminPage productRepository={deleteRaceRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Produkter \(2\)/i })).toBeInTheDocument();
    });

    const desktopList = screen.getByTestId('admin-products-desktop');
    const rowA = within(desktopList).getByText('Produkt A').closest('tr')!;
    const rowB = within(desktopList).getByText('Produkt B').closest('tr')!;

    // 1. Start editing Produkt A
    await user.click(within(rowA).getByRole('button', { name: 'Rediger' }));
    expect(screen.getByRole('heading', { name: 'Rediger produkt' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tittel')).toHaveValue('Produkt A');

    // 2. Click Slett on Produkt A (delete awaits)
    await user.click(within(rowA).getByRole('button', { name: 'Slett' }));

    // 3. Switch edit target to Produkt B while delete(A) is still pending
    await user.click(within(rowB).getByRole('button', { name: 'Rediger' }));
    expect(screen.getByRole('heading', { name: 'Rediger produkt' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tittel')).toHaveValue('Produkt B');

    // 4. Resolve delete(A) -> MUST NOT wipe Produkt B's active edit form
    await act(async () => {
      resolveDeleteA();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Produkter \(1\)/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Rediger produkt' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tittel')).toHaveValue('Produkt B');
  });

  it('CatalogProvider ignores stale initial listActive() resolution when concurrent refreshCatalog() completes first', async () => {
    const starter = getStarterProducts();
    const newProd: Product = {
      ...starter[0],
      id: 'new-prod-race',
      slug: 'nytt-produkt',
      title: 'Ny Produkt',
    };

    let resolveInitial!: (products: Product[]) => void;
    let resolveRefresh!: (products: Product[]) => void;
    const listActiveMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Product[]>((resolve) => {
            resolveInitial = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Product[]>((resolve) => {
            resolveRefresh = resolve;
          }),
      );

    const raceRepo: IProductRepository = {
      listAll: vi.fn().mockResolvedValue([]),
      listActive: listActiveMock,
      listByCategory: vi.fn().mockResolvedValue([]),
      getById: vi.fn().mockResolvedValue(null),
      getBySlug: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    function RaceProbe() {
      const { products, refreshCatalog } = useCatalog();
      return (
        <div>
          <span data-testid="race-titles">{products.map((p) => p.title).join('|')}</span>
          <button type="button" onClick={() => void refreshCatalog()}>
            RefreshRace
          </button>
        </div>
      );
    }

    const user = userEvent.setup({ delay: null });
    render(
      <CatalogProvider productRepository={raceRepo}>
        <RaceProbe />
      </CatalogProvider>,
    );

    // Trigger faster refreshCatalog() while initial load is still in flight
    await user.click(screen.getByRole('button', { name: 'RefreshRace' }));

    await act(async () => {
      resolveRefresh([starter[0], newProd]);
      await Promise.resolve();
    });
    expect(screen.getByTestId('race-titles')).toHaveTextContent('Army sekk|Ny Produkt');

    // Now resolve the older stale initial listActive() -> must NOT overwrite newer catalog
    await act(async () => {
      resolveInitial([starter[0]]);
      await Promise.resolve();
    });
    expect(screen.getByTestId('race-titles')).toHaveTextContent('Army sekk|Ny Produkt');
  });

  it('CatalogProvider with remote IProductRepository does NOT re-create deleted products on refresh or expose fake starter products when all products are deactivated', async () => {
    const starter = getStarterProducts();
    const deactivated = starter.map((p) => ({ ...p, active: false }));
    const createMock = vi.fn();

    const remoteDeactivatedRepo: IProductRepository = {
      listAll: vi.fn().mockResolvedValue(deactivated),
      listActive: vi.fn().mockResolvedValue([]),
      listByCategory: vi.fn().mockResolvedValue([]),
      getById: vi.fn(async (id: string) => deactivated.find((p) => p.id === id) ?? null),
      getBySlug: vi.fn().mockResolvedValue(null),
      create: createMock,
      update: vi.fn(),
      delete: vi.fn(),
    };

    const user = userEvent.setup({ delay: null });
    const { unmount } = render(
      <CatalogProvider productRepository={remoteDeactivatedRepo}>
        <CatalogRegressionProbe />
      </CatalogProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('catalog-loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('catalog-count')).toHaveTextContent('0');
    expect(createMock).not.toHaveBeenCalled();

    // Subsequent refreshCatalog after admin deletes everything must also stay 0 and not reseed
    await user.click(screen.getByRole('button', { name: 'Oppdater katalog' }));
    await waitFor(() => {
      expect(screen.getByTestId('catalog-count')).toHaveTextContent('0');
    });
    expect(createMock).not.toHaveBeenCalled();
    unmount();

    // Non-admin visitor when all starter products are deactivated (getById throws permission-denied)
    // must NOT fall back to fake starter products
    const nonAdminDeactivatedRepo: IProductRepository = {
      listAll: vi.fn().mockRejectedValue(new Error('permission-denied')),
      listActive: vi.fn().mockResolvedValue([]),
      listByCategory: vi.fn().mockResolvedValue([]),
      getById: vi.fn().mockRejectedValue(
        Object.assign(new Error('Missing or insufficient permissions.'), {
          code: 'permission-denied',
        }),
      ),
      getBySlug: vi.fn().mockResolvedValue(null),
      create: createMock,
      update: vi.fn(),
      delete: vi.fn(),
    };

    render(
      <CatalogProvider productRepository={nonAdminDeactivatedRepo}>
        <CatalogRegressionProbe />
      </CatalogProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('catalog-loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('catalog-count')).toHaveTextContent('0');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('AdminPage enforces synchronous ref lock on same-tick Deaktiver/Slett double-clicks and supports tablist Arrow/Home/End navigation', async () => {
    const starter = getStarterProducts();
    let resolveUpdate!: (p: Product) => void;
    let resolveDelete!: () => void;

    const updateSpy = vi.fn(
      () =>
        new Promise<Product>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const deleteSpy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );

    const lockRepo: IProductRepository = {
      listAll: vi.fn().mockResolvedValue([starter[0], starter[1]]),
      listActive: vi.fn().mockResolvedValue([starter[0], starter[1]]),
      listByCategory: vi.fn().mockResolvedValue([]),
      getById: vi.fn().mockResolvedValue(starter[0]),
      getBySlug: vi.fn().mockResolvedValue(starter[0]),
      create: vi.fn(),
      update: updateSpy,
      delete: deleteSpy,
    };

    const adminUser = {
      uid: 'admin-lock',
      email: ADMIN_ALLOWLIST_EMAIL,
      displayName: 'Admin',
      emailVerified: true,
      isAnonymous: false,
    };

    render(
      <MemoryRouter>
        <AuthProvider initialUser={adminUser} initialIsAdmin={true}>
          <AdminPage productRepository={lockRepo} />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Produkter \(2\)/i })).toBeInTheDocument();
    });

    // Keyboard navigation on role="tablist"
    const user = userEvent.setup({ delay: null });
    const productsTab = screen.getByRole('tab', { name: /Produkter/i });
    const ordersTab = screen.getByRole('tab', { name: /Bestillinger/i });
    const messagesTab = screen.getByRole('tab', { name: /Henvendelser/i });

    productsTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(ordersTab).toHaveAttribute('aria-selected', 'true');
    expect(ordersTab).toHaveFocus();

    await user.keyboard('{End}');
    expect(messagesTab).toHaveAttribute('aria-selected', 'true');
    expect(messagesTab).toHaveFocus();

    await user.keyboard('{Home}');
    expect(productsTab).toHaveAttribute('aria-selected', 'true');
    expect(productsTab).toHaveFocus();

    // Same-tick double-click on Deaktiver and Slett must invoke update/delete only once
    const desktopList = screen.getByTestId('admin-products-desktop');
    const row0 = within(desktopList).getByText(starter[0].title).closest('tr')!;
    const row1 = within(desktopList).getByText(starter[1].title).closest('tr')!;

    const deactivateBtn = within(row0).getByRole('button', { name: 'Deaktiver' });
    const deleteBtn = within(row1).getByRole('button', { name: 'Slett' });
    act(() => {
      deactivateBtn.click();
      deactivateBtn.click();
      deleteBtn.click();
      deleteBtn.click();
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUpdate({ ...starter[0], active: false });
      resolveDelete();
      await Promise.resolve();
    });
  });
});
