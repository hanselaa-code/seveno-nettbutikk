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
});
