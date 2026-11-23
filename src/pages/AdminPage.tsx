import { LogOut, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useOptionalAuth } from '../context/AuthContext';
import { useOptionalCatalog } from '../context/CatalogContext';
import { formatNok, slugify } from '../lib/format';
import { isValidEmail, isValidImageUrl, validateProductInput, ValidationError } from '../lib/validators';
import { getContactRepository } from '../repositories/contactRepository';
import type { IContactRepository } from '../repositories/contactRepository';
import { getOrderRepository } from '../repositories/orderRepository';
import type { IOrderRepository } from '../repositories/orderRepository';
import { LocalProductRepository, getProductRepository } from '../repositories/productRepository';
import type { IProductRepository } from '../repositories/productRepository';
import {
  clearCatalogIntentionallyEmptied,
  ensureAdminColdStartSeed,
  isCatalogIntentionallyEmptied,
  markCatalogIntentionallyEmptied,
} from '../repositories/seedCatalog';
import { CATEGORIES, DEFAULT_PRODUCT_IMAGE } from '../types/domain';
import type {
  CategorySlug,
  ContactMessage,
  CreateProductInput,
  Order,
  Product,
} from '../types/domain';

export interface AdminPageProps {
  productRepository?: IProductRepository;
  orderRepository?: IOrderRepository;
  contactRepository?: IContactRepository;
}

type AdminTab = 'products' | 'orders' | 'messages';

export const PRODUCT_IMAGE_PRESETS = [
  { value: DEFAULT_PRODUCT_IMAGE, label: 'Standard Seveno-illustrasjon' },
  { value: '/images/products/army-sekk.svg', label: 'Army sekk' },
  { value: '/images/products/skobeholder.svg', label: 'Akryl skobeholder' },
  { value: '/images/products/pergola.svg', label: 'Pergola' },
] as const;

const PRESET_IMAGE_VALUES: readonly string[] = PRODUCT_IMAGE_PRESETS.map((item) => item.value);

function resolveImagePreset(imageUrl: string): string {
  const trimmed = imageUrl.trim();
  return PRESET_IMAGE_VALUES.includes(trimmed) ? trimmed : 'custom';
}

function formatDateNb(iso: string): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString('nb-NO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ProductThumbnail({ src, alt }: { src: string; alt: string }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const safeSrc = src.trim() && isValidImageUrl(src) ? src.trim() : '';
  const resolvedSrc = hasError || !safeSrc ? DEFAULT_PRODUCT_IMAGE : safeSrc;

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      onError={() => {
        if (!hasError) {
          setHasError(true);
        }
      }}
      className="h-14 w-14 shrink-0 rounded-md border border-sand bg-canvas object-contain p-1"
    />
  );
}

export function AdminPage({
  productRepository,
  orderRepository,
  contactRepository,
}: AdminPageProps) {
  const optionalAuth = useOptionalAuth();
  const optionalCatalog = useOptionalCatalog();

  const user = optionalAuth?.user ?? null;
  const isAdmin = optionalAuth?.isAdmin ?? false;
  const authLoading = optionalAuth?.loading ?? false;
  const authError = optionalAuth?.error ?? null;
  const isFirebaseAuthAvailable = optionalAuth?.isFirebaseAuthAvailable ?? false;
  const signInWithEmail = optionalAuth?.signInWithEmail;
  const signInWithGoogle = optionalAuth?.signInWithGoogle;
  const signOut = optionalAuth?.signOut;
  const clearAuthError = optionalAuth?.clearError;

  const resolvedProductRepo = useMemo(
    () => productRepository ?? getProductRepository(),
    [productRepository],
  );
  const resolvedOrderRepo = useMemo(
    () => orderRepository ?? getOrderRepository(),
    [orderRepository],
  );
  const resolvedContactRepo = useMemo(
    () => contactRepository ?? getContactRepository(),
    [contactRepository],
  );

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginFieldErrors, setLoginFieldErrors] = useState<Record<string, string>>({});
  const [loginSubmitError, setLoginSubmitError] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);

  // Dashboard state
  const [activeTab, setActiveTab] = useState<AdminTab>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  // Product form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [categorySlug, setCategorySlug] = useState<CategorySlug>('seveno-living');
  const [priceNok, setPriceNok] = useState('');
  const [stock, setStock] = useState('10');
  const [description, setDescription] = useState('');
  const [specsText, setSpecsText] = useState('');
  const [imagePreset, setImagePreset] = useState<string>(DEFAULT_PRODUCT_IMAGE);
  const [imageUrl, setImageUrl] = useState<string>(DEFAULT_PRODUCT_IMAGE);
  const [active, setActive] = useState(true);

  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [busyProductIds, setBusyProductIds] = useState<Set<string>>(() => new Set());

  const savingRef = useRef(false);
  const authPendingRef = useRef(false);
  const busyProductIdsRef = useRef<Set<string>>(new Set());
  const refreshCatalogRef = useRef(optionalCatalog?.refreshCatalog);
  refreshCatalogRef.current = optionalCatalog?.refreshCatalog;
  const tabRefs = useRef<Record<AdminTab, HTMLButtonElement | null>>({
    products: null,
    orders: null,
    messages: null,
  });
  const dashboardRequestIdRef = useRef(0);
  const productsMutationVersionRef = useRef(0);
  const formSaveAttemptRef = useRef(0);
  const hasLoadedProductsRef = useRef(false);
  const formSessionVersionRef = useRef(0);
  const editingIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isAuthorizedAdmin = Boolean(user && !user.isAnonymous && isAdmin);
  const authorizedSessionKey = isAuthorizedAdmin
    ? (user?.uid || user?.email || 'admin')
    : null;

  const markProductBusy = useCallback((productId: string) => {
    setBusyProductIds((prev) => {
      const next = new Set(prev);
      next.add(productId);
      return next;
    });
  }, []);

  const unmarkProductBusy = useCallback((productId: string) => {
    setBusyProductIds((prev) => {
      if (!prev.has(productId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
  }, []);

  const recoverProductsIfUnloaded = useCallback(
    async (expectedVersion: number) => {
      if (
        !isAuthorizedAdmin ||
        hasLoadedProductsRef.current ||
        expectedVersion !== productsMutationVersionRef.current
      ) {
        return;
      }
      setLoadingProducts(true);
      try {
        const recovered = await resolvedProductRepo.listAll();
        if (
          !isMountedRef.current ||
          expectedVersion !== productsMutationVersionRef.current
        ) {
          return;
        }
        if (recovered.length > 0 && !(resolvedProductRepo instanceof LocalProductRepository)) {
          clearCatalogIntentionallyEmptied();
        }
        hasLoadedProductsRef.current = true;
        setProducts(recovered);
        setProductsError(null);
      } catch {
        if (
          !isMountedRef.current ||
          expectedVersion !== productsMutationVersionRef.current
        ) {
          return;
        }
        setProductsError('Kunne ikke hente produktlisten fra databasen.');
      } finally {
        if (isMountedRef.current && expectedVersion === productsMutationVersionRef.current) {
          setLoadingProducts(false);
        }
      }
    },
    [isAuthorizedAdmin, resolvedProductRepo],
  );

  const loadDashboardData = useCallback(async () => {
    if (!isAuthorizedAdmin) {
      return;
    }

    const requestId = ++dashboardRequestIdRef.current;
    const productsVersion = productsMutationVersionRef.current;
    setLoadingProducts(true);
    setProductsError(null);
    setOrdersError(null);
    setMessagesError(null);

    const [productsRes, ordersRes, messagesRes] = await Promise.allSettled([
      resolvedProductRepo.listAll(),
      resolvedOrderRepo.listAll(),
      resolvedContactRepo.listAll(),
    ]);

    if (!isMountedRef.current || requestId !== dashboardRequestIdRef.current) {
      return;
    }

    if (ordersRes.status === 'fulfilled') {
      setOrders(ordersRes.value);
    } else {
      setOrdersError('Kunne ikke hente bestillinger akkurat nå.');
    }

    if (messagesRes.status === 'fulfilled') {
      setMessages(messagesRes.value);
    } else {
      setMessagesError('Kunne ikke hente henvendelser akkurat nå.');
    }

    if (productsVersion === productsMutationVersionRef.current) {
      if (productsRes.status === 'fulfilled') {
        if (productsRes.value.length > 0) {
          if (!(resolvedProductRepo instanceof LocalProductRepository)) {
            clearCatalogIntentionallyEmptied();
          }
          hasLoadedProductsRef.current = true;
          setProducts(productsRes.value);
          setLoadingProducts(false);
        } else if (
          !(resolvedProductRepo instanceof LocalProductRepository) &&
          !isCatalogIntentionallyEmptied()
        ) {
          try {
            const seedResult = await ensureAdminColdStartSeed(resolvedProductRepo);
            if (!isMountedRef.current || requestId !== dashboardRequestIdRef.current) {
              return;
            }
            if (productsVersion === productsMutationVersionRef.current) {
              hasLoadedProductsRef.current = true;
              setProducts(seedResult.products);
              setLoadingProducts(false);
              if (seedResult.seeded) {
                void refreshCatalogRef.current?.();
              }
            }
          } catch {
            if (!isMountedRef.current || requestId !== dashboardRequestIdRef.current) {
              return;
            }
            if (productsVersion === productsMutationVersionRef.current) {
              hasLoadedProductsRef.current = true;
              setProducts(productsRes.value);
              setLoadingProducts(false);
            }
          }
        } else {
          hasLoadedProductsRef.current = true;
          setProducts(productsRes.value);
          setLoadingProducts(false);
        }
      } else {
        setProductsError('Kunne ikke hente produktlisten fra databasen.');
        setLoadingProducts(false);
      }
    }
  }, [isAuthorizedAdmin, resolvedContactRepo, resolvedOrderRepo, resolvedProductRepo]);

  const resetProductForm = useCallback(() => {
    formSessionVersionRef.current += 1;
    editingIdRef.current = null;
    setEditingId(null);
    setTitle('');
    setSlug('');
    setSlugManuallyEdited(false);
    setCategorySlug('seveno-living');
    setPriceNok('');
    setStock('10');
    setDescription('');
    setSpecsText('');
    setImagePreset(DEFAULT_PRODUCT_IMAGE);
    setImageUrl(DEFAULT_PRODUCT_IMAGE);
    setActive(true);
    setFormFieldErrors({});
    setFormError(null);
  }, []);

  useEffect(() => {
    dashboardRequestIdRef.current += 1;
    productsMutationVersionRef.current += 1;
    formSaveAttemptRef.current += 1;
    hasLoadedProductsRef.current = false;
    savingRef.current = false;
    setSavingProduct(false);
    resetProductForm();
    setStatusMessage(null);

    if (authorizedSessionKey) {
      void loadDashboardData();
    } else {
      setProducts([]);
      setOrders([]);
      setMessages([]);
      busyProductIdsRef.current.clear();
      setBusyProductIds(new Set());
      setLoadingProducts(false);
      setProductsError(null);
      setOrdersError(null);
      setMessagesError(null);
    }
  }, [authorizedSessionKey, loadDashboardData, resetProductForm]);

  const clearProductFieldError = (field: string) => {
    setFormFieldErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authPendingRef.current) {
      return;
    }

    setLoginSubmitError(null);
    clearAuthError?.();

    const errors: Record<string, string> = {};
    if (!isValidEmail(loginEmail)) {
      errors.email = 'Oppgi en gyldig e-postadresse.';
    }
    if (!loginPassword.trim()) {
      errors.password = 'Oppgi passord.';
    }

    if (Object.keys(errors).length > 0) {
      setLoginFieldErrors(errors);
      return;
    }

    setLoginFieldErrors({});
    if (!signInWithEmail) {
      setLoginSubmitError(
        'Innlogging er ikke tilgjengelig uten aktiv AuthProvider-konfigurasjon.',
      );
      return;
    }

    authPendingRef.current = true;
    setAuthPending(true);
    try {
      await signInWithEmail(loginEmail.trim(), loginPassword);
      if (isMountedRef.current) {
        setLoginPassword('');
      }
    } catch (err) {
      if (isMountedRef.current) {
        setLoginSubmitError(
          err instanceof Error && err.message
            ? err.message
            : 'Kunne ikke logge inn. Kontroller opplysningene og prøv igjen.',
        );
      }
    } finally {
      authPendingRef.current = false;
      if (isMountedRef.current) {
        setAuthPending(false);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    if (authPendingRef.current) {
      return;
    }

    setLoginSubmitError(null);
    setLoginFieldErrors({});
    clearAuthError?.();

    if (!signInWithGoogle) {
      setLoginSubmitError(
        'Google-innlogging er ikke tilgjengelig uten aktiv AuthProvider-konfigurasjon.',
      );
      return;
    }

    authPendingRef.current = true;
    setAuthPending(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      if (isMountedRef.current) {
        setLoginSubmitError(
          err instanceof Error && err.message
            ? err.message
            : 'Google-innlogging feilet. Prøv igjen.',
        );
      }
    } finally {
      authPendingRef.current = false;
      if (isMountedRef.current) {
        setAuthPending(false);
      }
    }
  };

  const handleSignOut = async () => {
    if (!signOut || authPendingRef.current) {
      return;
    }
    authPendingRef.current = true;
    setAuthPending(true);
    try {
      await signOut();
      if (isMountedRef.current) {
        resetProductForm();
        setStatusMessage(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setFormError(err instanceof Error ? err.message : 'Kunne ikke logge ut.');
      }
    } finally {
      authPendingRef.current = false;
      if (isMountedRef.current) {
        setAuthPending(false);
      }
    }
  };

  const handleProductSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) {
      return;
    }

    setFormError(null);
    setStatusMessage(null);

    const parsedPrice = priceNok.trim() === '' ? Number.NaN : Number(priceNok);
    const parsedStock = stock.trim() === '' ? Number.NaN : Number(stock);
    const parsedSpecs = specsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const candidate: CreateProductInput = {
      title,
      slug,
      categorySlug,
      description,
      priceNok: parsedPrice,
      stock: parsedStock,
      imageUrl: imageUrl.trim() || DEFAULT_PRODUCT_IMAGE,
      specs: parsedSpecs,
      active,
    };

    const validation = validateProductInput(candidate);
    if (!validation.valid || !validation.value) {
      setFormFieldErrors(validation.errors);
      return;
    }

    setFormFieldErrors({});
    savingRef.current = true;
    const saveAttemptId = ++formSaveAttemptRef.current;
    const mutationVersion = ++productsMutationVersionRef.current;
    const formVersionAtSubmit = formSessionVersionRef.current;
    const targetEditingId = editingIdRef.current;
    setSavingProduct(true);

    try {
      const saved = targetEditingId
        ? await resolvedProductRepo.update(targetEditingId, validation.value)
        : await resolvedProductRepo.create(validation.value);

      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }

      const refreshedList = await resolvedProductRepo.listAll();

      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }

      if (!(resolvedProductRepo instanceof LocalProductRepository)) {
        if (refreshedList.length === 0) {
          markCatalogIntentionallyEmptied();
        } else {
          clearCatalogIntentionallyEmptied();
        }
      }

      await optionalCatalog?.refreshCatalog();

      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }

      hasLoadedProductsRef.current = true;
      setProducts(refreshedList);
      setProductsError(null);
      setLoadingProducts(false);
      if (formSessionVersionRef.current === formVersionAtSubmit) {
        resetProductForm();
      }
      setStatusMessage(
        (saved?.active ?? validation.value.active)
          ? 'Produktet er lagret og publisert i butikken.'
          : 'Produktet er lagret som deaktivert (skjult fra butikken).',
      );
    } catch (err) {
      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }
      if (err instanceof ValidationError) {
        setFormFieldErrors(err.errors);
        setFormError(err.message);
      } else {
        setFormError(
          err instanceof Error && err.message
            ? err.message
            : 'Kunne ikke lagre produktet. Prøv igjen.',
        );
      }
      if (!hasLoadedProductsRef.current) {
        void recoverProductsIfUnloaded(mutationVersion);
      } else {
        setLoadingProducts(false);
      }
    } finally {
      if (saveAttemptId === formSaveAttemptRef.current) {
        savingRef.current = false;
        if (isMountedRef.current) {
          setSavingProduct(false);
        }
      }
    }
  };

  const handleStartEdit = (product: Product) => {
    formSessionVersionRef.current += 1;
    editingIdRef.current = product.id;
    setEditingId(product.id);
    setTitle(product.title);
    setSlug(product.slug);
    setSlugManuallyEdited(true);
    setCategorySlug(product.categorySlug);
    setPriceNok(String(product.priceNok));
    setStock(String(product.stock));
    setDescription(product.description);
    setSpecsText(product.specs.join('\n'));
    const nextImage = product.imageUrl || DEFAULT_PRODUCT_IMAGE;
    setImageUrl(nextImage);
    setImagePreset(resolveImagePreset(nextImage));
    setActive(product.active);
    setFormFieldErrors({});
    setFormError(null);
    setStatusMessage(null);
  };

  const handleToggleActive = async (product: Product) => {
    if (busyProductIdsRef.current.has(product.id)) {
      return;
    }
    busyProductIdsRef.current.add(product.id);
    setFormError(null);
    setStatusMessage(null);
    const mutationVersion = ++productsMutationVersionRef.current;
    markProductBusy(product.id);

    try {
      await resolvedProductRepo.update(product.id, { active: !product.active });

      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }

      const refreshedList = await resolvedProductRepo.listAll();

      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }

      if (!(resolvedProductRepo instanceof LocalProductRepository)) {
        if (refreshedList.length === 0) {
          markCatalogIntentionallyEmptied();
        } else {
          clearCatalogIntentionallyEmptied();
        }
      }

      await optionalCatalog?.refreshCatalog();

      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }

      hasLoadedProductsRef.current = true;
      setProducts(refreshedList);
      setProductsError(null);
      setLoadingProducts(false);
      setStatusMessage(
        !product.active
          ? `«${product.title}» er aktivert i nettbutikken.`
          : `«${product.title}» er deaktivert og skjult fra nettbutikken.`,
      );
    } catch (err) {
      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }
      setFormError(
        err instanceof Error && err.message
          ? err.message
          : 'Kunne ikke oppdatere produktstatus.',
      );
      if (!hasLoadedProductsRef.current) {
        void recoverProductsIfUnloaded(mutationVersion);
      }
    } finally {
      busyProductIdsRef.current.delete(product.id);
      if (isMountedRef.current) {
        unmarkProductBusy(product.id);
      }
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    if (busyProductIdsRef.current.has(product.id)) {
      return;
    }
    busyProductIdsRef.current.add(product.id);
    setFormError(null);
    setStatusMessage(null);
    const mutationVersion = ++productsMutationVersionRef.current;
    markProductBusy(product.id);

    try {
      await resolvedProductRepo.delete(product.id);

      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }

      const refreshedList = await resolvedProductRepo.listAll();

      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }

      if (!(resolvedProductRepo instanceof LocalProductRepository)) {
        if (refreshedList.length === 0) {
          markCatalogIntentionallyEmptied();
        } else {
          clearCatalogIntentionallyEmptied();
        }
      }

      await optionalCatalog?.refreshCatalog();

      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }

      hasLoadedProductsRef.current = true;
      setProducts(refreshedList);
      setProductsError(null);
      setLoadingProducts(false);
      if (editingIdRef.current === product.id) {
        resetProductForm();
      }
      setStatusMessage(`«${product.title}» er slettet fra katalogen.`);
    } catch (err) {
      if (!isMountedRef.current || mutationVersion !== productsMutationVersionRef.current) {
        return;
      }
      setFormError(
        err instanceof Error && err.message ? err.message : 'Kunne ikke slette produktet.',
      );
      if (!hasLoadedProductsRef.current) {
        void recoverProductsIfUnloaded(mutationVersion);
      }
    } finally {
      busyProductIdsRef.current.delete(product.id);
      if (isMountedRef.current) {
        unmarkProductBusy(product.id);
      }
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabOrder: readonly AdminTab[] = ['products', 'orders', 'messages'];
    const currentIndex = tabOrder.indexOf(activeTab);
    let nextTab: AdminTab | undefined;

    if (event.key === 'ArrowRight') {
      nextTab = tabOrder[(currentIndex + 1) % tabOrder.length];
    } else if (event.key === 'ArrowLeft') {
      nextTab = tabOrder[(currentIndex - 1 + tabOrder.length) % tabOrder.length];
    } else if (event.key === 'Home') {
      nextTab = tabOrder[0];
    } else if (event.key === 'End') {
      nextTab = tabOrder[tabOrder.length - 1];
    }

    if (nextTab) {
      event.preventDefault();
      setActiveTab(nextTab);
      tabRefs.current[nextTab]?.focus();
    }
  };

  const inputBaseClass =
    'mt-1.5 w-full rounded-md border bg-canvas px-3.5 py-2.5 text-sm text-espresso placeholder:text-taupe focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze';

  const displayLoginError = loginSubmitError ?? authError;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-sand pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">
            Administrasjon
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold text-espresso sm:text-4xl">
            Administrasjon
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-charcoal">
            Administrer produkter, priser, lagerbeholdning, bestillinger og kundehenvendelser i
            Seveno Nettbutikk.
          </p>
        </div>

        {user && !user.isAnonymous && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-charcoal">
              <span className="text-taupe">Innlogget som </span>
              <span className="font-semibold text-espresso">
                {user.email ?? user.displayName ?? user.uid}
              </span>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={authPending}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-sand bg-ivory px-4 py-2 text-sm font-semibold text-espresso transition-colors hover:border-bronze hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Logg ut
              </button>
            )}
          </div>
        )}
      </div>

      {authLoading ? (
        <div
          role="status"
          className="mt-8 rounded-xl border border-sand bg-ivory p-8 text-sm font-medium text-charcoal shadow-nordic"
        >
          Kontrollerer administratortilgang ...
        </div>
      ) : !user || user.isAnonymous ? (
        <div className="mx-auto mt-8 max-w-lg rounded-xl border border-sand bg-ivory p-6 shadow-nordic sm:p-8">
          <h2 className="font-serif text-2xl font-semibold text-espresso">
            Administratorinnlogging
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-charcoal">
            Logg inn med administrator-konto for å legge til eller redigere produkter i databasen.
          </p>

          {!isFirebaseAuthAvailable && (
            <div className="mt-4 rounded-md border border-sand bg-linen px-4 py-3 text-xs leading-relaxed text-charcoal">
              Firebase Auth er ikke konfigurert i dette lokale miljøet. Konfigurer{' '}
              <code>VITE_FIREBASE_*</code>-miljøvariablene for live innlogging mot Firebase.
            </div>
          )}

          <form onSubmit={handleLoginSubmit} noValidate className="mt-6 space-y-5">
            <div>
              <label htmlFor="admin-email" className="block text-sm font-medium text-espresso">
                E-postadresse
              </label>
              <input
                id="admin-email"
                name="email"
                type="email"
                autoComplete="email"
                value={loginEmail}
                onChange={(e) => {
                  setLoginEmail(e.target.value);
                  setLoginFieldErrors((prev) => {
                    if (!prev.email) return prev;
                    const next = { ...prev };
                    delete next.email;
                    return next;
                  });
                }}
                aria-invalid={Boolean(loginFieldErrors.email)}
                aria-describedby={loginFieldErrors.email ? 'admin-email-error' : undefined}
                placeholder="admin@seveno.no"
                className={`${inputBaseClass} ${
                  loginFieldErrors.email ? 'border-error' : 'border-sand'
                }`}
              />
              {loginFieldErrors.email && (
                <p
                  id="admin-email-error"
                  role="alert"
                  className="mt-1.5 text-xs font-medium text-error"
                >
                  {loginFieldErrors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-sm font-medium text-espresso">
                Passord
              </label>
              <input
                id="admin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => {
                  setLoginPassword(e.target.value);
                  setLoginFieldErrors((prev) => {
                    if (!prev.password) return prev;
                    const next = { ...prev };
                    delete next.password;
                    return next;
                  });
                }}
                aria-invalid={Boolean(loginFieldErrors.password)}
                aria-describedby={loginFieldErrors.password ? 'admin-password-error' : undefined}
                placeholder="••••••••"
                className={`${inputBaseClass} ${
                  loginFieldErrors.password ? 'border-error' : 'border-sand'
                }`}
              />
              {loginFieldErrors.password && (
                <p
                  id="admin-password-error"
                  role="alert"
                  className="mt-1.5 text-xs font-medium text-error"
                >
                  {loginFieldErrors.password}
                </p>
              )}
            </div>

            {displayLoginError && (
              <div
                role="alert"
                className="rounded-md border border-error/30 bg-canvas px-4 py-3 text-sm font-medium text-error"
              >
                {displayLoginError}
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={authPending}
                aria-busy={authPending}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-bronze px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-60"
              >
                {authPending ? 'Logger inn ...' : 'Logg inn'}
              </button>

              <button
                type="button"
                onClick={() => void handleGoogleSignIn()}
                disabled={authPending}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-sand bg-canvas px-5 py-2.5 text-sm font-semibold text-espresso transition-colors hover:border-bronze hover:bg-linen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-60"
              >
                Logg inn med Google
              </button>
            </div>
          </form>
        </div>
      ) : !isAdmin ? (
        <div
          role="alert"
          className="mx-auto mt-8 max-w-xl rounded-xl border border-error/30 bg-ivory p-6 shadow-nordic sm:p-8"
        >
          <h2 className="font-serif text-2xl font-semibold text-espresso">
            Ingen administratortilgang
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-charcoal">
            Kontoen <strong>{user.email ?? user.uid}</strong> har ikke administratorrettigheter i
            Seveno Nettbutikk. Logg ut og logg inn med en godkjent administratorkonto.
          </p>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={authPending}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-bronze px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Logg ut
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <div
            role="tablist"
            aria-label="Administrasjonsfaner"
            onKeyDown={handleTabKeyDown}
            className="flex flex-wrap gap-2 border-b border-sand pb-3"
          >
            <button
              ref={(el) => {
                tabRefs.current.products = el;
              }}
              id="admin-tab-products"
              type="button"
              role="tab"
              tabIndex={activeTab === 'products' ? 0 : -1}
              aria-selected={activeTab === 'products'}
              aria-controls="admin-panel-products"
              onClick={() => setActiveTab('products')}
              className={`inline-flex min-h-[44px] items-center rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze ${
                activeTab === 'products'
                  ? 'bg-bronze text-white'
                  : 'border border-sand bg-ivory text-espresso hover:border-bronze hover:bg-linen'
              }`}
            >
              Produkter ({products.length})
            </button>

            <button
              ref={(el) => {
                tabRefs.current.orders = el;
              }}
              id="admin-tab-orders"
              type="button"
              role="tab"
              tabIndex={activeTab === 'orders' ? 0 : -1}
              aria-selected={activeTab === 'orders'}
              aria-controls="admin-panel-orders"
              onClick={() => setActiveTab('orders')}
              className={`inline-flex min-h-[44px] items-center rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze ${
                activeTab === 'orders'
                  ? 'bg-bronze text-white'
                  : 'border border-sand bg-ivory text-espresso hover:border-bronze hover:bg-linen'
              }`}
            >
              Bestillinger ({orders.length})
            </button>

            <button
              ref={(el) => {
                tabRefs.current.messages = el;
              }}
              id="admin-tab-messages"
              type="button"
              role="tab"
              tabIndex={activeTab === 'messages' ? 0 : -1}
              aria-selected={activeTab === 'messages'}
              aria-controls="admin-panel-messages"
              onClick={() => setActiveTab('messages')}
              className={`inline-flex min-h-[44px] items-center rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze ${
                activeTab === 'messages'
                  ? 'bg-bronze text-white'
                  : 'border border-sand bg-ivory text-espresso hover:border-bronze hover:bg-linen'
              }`}
            >
              Henvendelser ({messages.length})
            </button>
          </div>

          {activeTab === 'products' && (
            <section
              id="admin-panel-products"
              role="tabpanel"
              aria-labelledby="admin-tab-products"
              className="grid gap-8 lg:grid-cols-12"
            >
              <div className="lg:col-span-5">
                <form
                  onSubmit={handleProductSubmit}
                  noValidate
                  className="space-y-5 rounded-xl border border-sand bg-ivory p-6 shadow-nordic sm:p-7"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-serif text-2xl font-semibold text-espresso">
                      {editingId ? 'Rediger produkt' : 'Legg til nytt produkt'}
                    </h2>
                    {editingId && (
                      <button
                        type="button"
                        onClick={resetProductForm}
                        className="text-xs font-semibold text-bronze underline underline-offset-4 hover:text-bronze-deep"
                      >
                        Avbryt redigering
                      </button>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="admin-product-title"
                      className="block text-sm font-medium text-espresso"
                    >
                      Tittel
                    </label>
                    <input
                      id="admin-product-title"
                      name="title"
                      type="text"
                      value={title}
                      onChange={(e) => {
                        const nextTitle = e.target.value;
                        setTitle(nextTitle);
                        clearProductFieldError('title');
                        if (!slugManuallyEdited && !editingId) {
                          setSlug(slugify(nextTitle));
                          clearProductFieldError('slug');
                        }
                      }}
                      aria-invalid={Boolean(formFieldErrors.title)}
                      aria-describedby={formFieldErrors.title ? 'admin-product-title-err' : undefined}
                      placeholder="Nordisk Ullpledd"
                      className={`${inputBaseClass} ${
                        formFieldErrors.title ? 'border-error' : 'border-sand'
                      }`}
                    />
                    {formFieldErrors.title && (
                      <p
                        id="admin-product-title-err"
                        role="alert"
                        className="mt-1.5 text-xs font-medium text-error"
                      >
                        {formFieldErrors.title}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="admin-product-slug"
                      className="block text-sm font-medium text-espresso"
                    >
                      URL-slug
                    </label>
                    <input
                      id="admin-product-slug"
                      name="slug"
                      type="text"
                      value={slug}
                      onChange={(e) => {
                        setSlug(e.target.value);
                        setSlugManuallyEdited(true);
                        clearProductFieldError('slug');
                      }}
                      aria-invalid={Boolean(formFieldErrors.slug)}
                      aria-describedby={formFieldErrors.slug ? 'admin-product-slug-err' : undefined}
                      placeholder="nordisk-ullpledd"
                      className={`${inputBaseClass} ${
                        formFieldErrors.slug ? 'border-error' : 'border-sand'
                      }`}
                    />
                    {formFieldErrors.slug && (
                      <p
                        id="admin-product-slug-err"
                        role="alert"
                        className="mt-1.5 text-xs font-medium text-error"
                      >
                        {formFieldErrors.slug}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="admin-product-category"
                      className="block text-sm font-medium text-espresso"
                    >
                      Kategori
                    </label>
                    <select
                      id="admin-product-category"
                      name="categorySlug"
                      value={categorySlug}
                      onChange={(e) => {
                        setCategorySlug(e.target.value as CategorySlug);
                        clearProductFieldError('categorySlug');
                      }}
                      aria-invalid={Boolean(formFieldErrors.categorySlug)}
                      className={`${inputBaseClass} ${
                        formFieldErrors.categorySlug ? 'border-error' : 'border-sand'
                      }`}
                    >
                      {CATEGORIES.map((category) => (
                        <option key={category.slug} value={category.slug}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    {formFieldErrors.categorySlug && (
                      <p role="alert" className="mt-1.5 text-xs font-medium text-error">
                        {formFieldErrors.categorySlug}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="admin-product-price"
                        className="block text-sm font-medium text-espresso"
                      >
                        Pris (NOK)
                      </label>
                      <input
                        id="admin-product-price"
                        name="priceNok"
                        type="number"
                        min={1}
                        step={1}
                        value={priceNok}
                        onChange={(e) => {
                          setPriceNok(e.target.value);
                          clearProductFieldError('priceNok');
                        }}
                        aria-invalid={Boolean(formFieldErrors.priceNok)}
                        aria-describedby={
                          formFieldErrors.priceNok ? 'admin-product-price-err' : undefined
                        }
                        placeholder="1290"
                        className={`${inputBaseClass} ${
                          formFieldErrors.priceNok ? 'border-error' : 'border-sand'
                        }`}
                      />
                      {formFieldErrors.priceNok && (
                        <p
                          id="admin-product-price-err"
                          role="alert"
                          className="mt-1.5 text-xs font-medium text-error"
                        >
                          {formFieldErrors.priceNok}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="admin-product-stock"
                        className="block text-sm font-medium text-espresso"
                      >
                        Antall på lager
                      </label>
                      <input
                        id="admin-product-stock"
                        name="stock"
                        type="number"
                        min={0}
                        step={1}
                        value={stock}
                        onChange={(e) => {
                          setStock(e.target.value);
                          clearProductFieldError('stock');
                        }}
                        aria-invalid={Boolean(formFieldErrors.stock)}
                        aria-describedby={
                          formFieldErrors.stock ? 'admin-product-stock-err' : undefined
                        }
                        placeholder="10"
                        className={`${inputBaseClass} ${
                          formFieldErrors.stock ? 'border-error' : 'border-sand'
                        }`}
                      />
                      {formFieldErrors.stock && (
                        <p
                          id="admin-product-stock-err"
                          role="alert"
                          className="mt-1.5 text-xs font-medium text-error"
                        >
                          {formFieldErrors.stock}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="admin-product-description"
                      className="block text-sm font-medium text-espresso"
                    >
                      Beskrivelse
                    </label>
                    <textarea
                      id="admin-product-description"
                      name="description"
                      rows={3}
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        clearProductFieldError('description');
                      }}
                      aria-invalid={Boolean(formFieldErrors.description)}
                      aria-describedby={
                        formFieldErrors.description ? 'admin-product-desc-err' : undefined
                      }
                      placeholder="Beskriv materialer, bruksområde og nordisk kvalitet..."
                      className={`${inputBaseClass} ${
                        formFieldErrors.description ? 'border-error' : 'border-sand'
                      }`}
                    />
                    {formFieldErrors.description && (
                      <p
                        id="admin-product-desc-err"
                        role="alert"
                        className="mt-1.5 text-xs font-medium text-error"
                      >
                        {formFieldErrors.description}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="admin-product-specs"
                      className="block text-sm font-medium text-espresso"
                    >
                      Spesifikasjoner (én per linje)
                    </label>
                    <textarea
                      id="admin-product-specs"
                      name="specs"
                      rows={3}
                      value={specsText}
                      onChange={(e) => {
                        setSpecsText(e.target.value);
                        clearProductFieldError('specs');
                      }}
                      aria-invalid={Boolean(formFieldErrors.specs)}
                      aria-describedby={
                        formFieldErrors.specs ? 'admin-product-specs-err' : undefined
                      }
                      placeholder={'Materiale: 100 % merinoull\nMål: 140 × 200 cm'}
                      className={`${inputBaseClass} ${
                        formFieldErrors.specs ? 'border-error' : 'border-sand'
                      }`}
                    />
                    {formFieldErrors.specs && (
                      <p
                        id="admin-product-specs-err"
                        role="alert"
                        className="mt-1.5 text-xs font-medium text-error"
                      >
                        {formFieldErrors.specs}
                      </p>
                    )}
                  </div>

                  <div className="space-y-3 rounded-lg border border-sand bg-linen/50 p-4">
                    <div>
                      <label
                        htmlFor="admin-product-image-preset"
                        className="block text-sm font-medium text-espresso"
                      >
                        Illustrasjonsmal
                      </label>
                      <select
                        id="admin-product-image-preset"
                        value={imagePreset}
                        onChange={(e) => {
                          const selected = e.target.value;
                          setImagePreset(selected);
                          if (selected !== 'custom') {
                            setImageUrl(selected);
                            clearProductFieldError('imageUrl');
                          }
                        }}
                        className={`${inputBaseClass} border-sand`}
                      >
                        {PRODUCT_IMAGE_PRESETS.map((preset) => (
                          <option key={preset.value} value={preset.value}>
                            {preset.label}
                          </option>
                        ))}
                        <option value="custom">Egendefinert bilde-URL</option>
                      </select>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <label
                          htmlFor="admin-product-image-url"
                          className="block text-sm font-medium text-espresso"
                        >
                          Bilde-URL
                        </label>
                        <input
                          id="admin-product-image-url"
                          name="imageUrl"
                          type="text"
                          value={imageUrl}
                          onChange={(e) => {
                            const nextUrl = e.target.value;
                            setImageUrl(nextUrl);
                            setImagePreset(resolveImagePreset(nextUrl));
                            clearProductFieldError('imageUrl');
                          }}
                          aria-invalid={Boolean(formFieldErrors.imageUrl)}
                          aria-describedby={
                            formFieldErrors.imageUrl ? 'admin-product-image-err' : undefined
                          }
                          placeholder={DEFAULT_PRODUCT_IMAGE}
                          className={`${inputBaseClass} ${
                            formFieldErrors.imageUrl ? 'border-error' : 'border-sand'
                          }`}
                        />
                        {formFieldErrors.imageUrl && (
                          <p
                            id="admin-product-image-err"
                            role="alert"
                            className="mt-1.5 text-xs font-medium text-error"
                          >
                            {formFieldErrors.imageUrl}
                          </p>
                        )}
                      </div>
                      <div className="pt-6">
                        <ProductThumbnail
                          src={imageUrl}
                          alt={title.trim() || 'Forhåndsvisning av produktbilde'}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <input
                      id="admin-product-active"
                      name="active"
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                      className="h-4 w-4 rounded border-sand accent-bronze"
                    />
                    <label
                      htmlFor="admin-product-active"
                      className="text-sm font-medium text-espresso"
                    >
                      Aktiv i nettbutikken
                    </label>
                  </div>

                  {formError && (
                    <div
                      role="alert"
                      className="rounded-md border border-error/30 bg-canvas px-4 py-3 text-sm font-medium text-error"
                    >
                      {formError}
                    </div>
                  )}

                  {statusMessage && (
                    <div
                      role="status"
                      className="rounded-md border border-success/30 bg-canvas px-4 py-3 text-sm font-medium text-success"
                    >
                      {statusMessage}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={savingProduct}
                    aria-busy={savingProduct}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-bronze px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {savingProduct
                      ? 'Lagrer ...'
                      : editingId
                        ? 'Oppdater produkt'
                        : 'Lagre produkt'}
                  </button>
                </form>
              </div>

              <div className="lg:col-span-7">
                <div className="rounded-xl border border-sand bg-ivory p-6 shadow-nordic sm:p-7">
                  <div className="flex items-center justify-between gap-3 border-b border-sand pb-4">
                    <h2 className="font-serif text-2xl font-semibold text-espresso">
                      Produktkatalog
                    </h2>
                    <span className="text-xs font-medium text-taupe">
                      {products.length} {products.length === 1 ? 'produkt' : 'produkter'}
                    </span>
                  </div>

                  {productsError && (
                    <div
                      role="alert"
                      className="mt-4 rounded-md border border-error/30 bg-canvas px-4 py-3 text-sm font-medium text-error"
                    >
                      {productsError}
                    </div>
                  )}

                  {loadingProducts ? (
                    <p role="status" className="mt-6 text-sm text-charcoal">
                      Laster produkter ...
                    </p>
                  ) : products.length === 0 ? (
                    <p className="mt-6 text-sm text-charcoal">
                      Ingen produkter registrert i katalogen ennå.
                    </p>
                  ) : (
                    <>
                      {/* Mobile stacked cards (< 768px) */}
                      <div data-testid="admin-products-mobile" className="mt-5 space-y-3 md:hidden">
                        {products.map((product) => {
                          const isBusy = busyProductIds.has(product.id);
                          return (
                            <article
                              key={product.id}
                              className="rounded-lg border border-sand bg-canvas p-4"
                            >
                              <div className="flex items-start gap-3">
                                <ProductThumbnail src={product.imageUrl} alt={product.title} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                                    <h3 className="min-w-0 wrap-anywhere font-serif text-lg font-semibold text-espresso">
                                      {product.title}
                                    </h3>
                                    <span
                                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                        product.active
                                          ? 'bg-success/15 text-success'
                                          : 'bg-linen text-taupe'
                                      }`}
                                    >
                                      {product.active ? 'Aktiv' : 'Deaktivert'}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-xs text-taupe">{product.categoryName}</p>
                                  <p className="mt-1.5 text-sm font-semibold text-espresso tabular-nums">
                                    {formatNok(product.priceNok)} · {product.stock} stk
                                  </p>
                                </div>
                              </div>

                              <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleStartEdit(product)}
                                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-sand bg-ivory px-3 py-1.5 text-xs font-semibold text-espresso transition-colors hover:border-bronze hover:bg-linen disabled:opacity-50"
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                  Rediger
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleToggleActive(product)}
                                  className="inline-flex min-h-[40px] items-center rounded-md border border-sand bg-ivory px-3 py-1.5 text-xs font-semibold text-espresso transition-colors hover:border-bronze hover:bg-linen disabled:opacity-50"
                                >
                                  {product.active ? 'Deaktiver' : 'Aktiver'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleDeleteProduct(product)}
                                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-error/30 bg-canvas px-3 py-1.5 text-xs font-semibold text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  Slett
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>

                      {/* Desktop table (>= 768px) */}
                      <div
                        data-testid="admin-products-desktop"
                        className="mt-5 hidden overflow-x-auto md:block"
                      >
                        <table className="w-full border-collapse text-left text-sm">
                          <thead>
                            <tr className="border-b border-sand text-xs uppercase tracking-wider text-taupe">
                              <th className="py-3 pr-3 font-semibold">Produkt</th>
                              <th className="px-3 py-3 font-semibold">Kategori</th>
                              <th className="px-3 py-3 font-semibold">Pris</th>
                              <th className="px-3 py-3 font-semibold">Lager</th>
                              <th className="px-3 py-3 font-semibold">Status</th>
                              <th className="py-3 pl-3 text-right font-semibold">Handlinger</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-sand">
                            {products.map((product) => {
                              const isBusy = busyProductIds.has(product.id);
                              return (
                                <tr key={product.id} className="align-middle">
                                  <td className="py-3 pr-3">
                                    <div className="flex items-center gap-3">
                                      <ProductThumbnail
                                        src={product.imageUrl}
                                        alt={product.title}
                                      />
                                      <div className="min-w-0">
                                        <p className="wrap-anywhere font-semibold text-espresso">
                                          {product.title}
                                        </p>
                                        <p className="wrap-anywhere text-xs text-taupe">
                                          {product.slug}
                                        </p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 text-charcoal">
                                    {product.categoryName}
                                  </td>
                                  <td className="px-3 py-3 font-medium text-espresso tabular-nums">
                                    {formatNok(product.priceNok)}
                                  </td>
                                  <td className="px-3 py-3 text-charcoal tabular-nums">
                                    {product.stock} stk
                                  </td>
                                  <td className="px-3 py-3">
                                    <span
                                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                        product.active
                                          ? 'bg-success/15 text-success'
                                          : 'bg-linen text-taupe'
                                      }`}
                                    >
                                      {product.active ? 'Aktiv' : 'Deaktivert'}
                                    </span>
                                  </td>
                                  <td className="py-3 pl-3">
                                    <div className="flex justify-end gap-2">
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => handleStartEdit(product)}
                                        className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-sand bg-canvas px-2.5 py-1 text-xs font-semibold text-espresso transition-colors hover:border-bronze hover:bg-linen disabled:opacity-50"
                                      >
                                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                        Rediger
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => void handleToggleActive(product)}
                                        className="inline-flex min-h-[36px] items-center rounded-md border border-sand bg-canvas px-2.5 py-1 text-xs font-semibold text-espresso transition-colors hover:border-bronze hover:bg-linen disabled:opacity-50"
                                      >
                                        {product.active ? 'Deaktiver' : 'Aktiver'}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => void handleDeleteProduct(product)}
                                        className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-error/30 bg-canvas px-2.5 py-1 text-xs font-semibold text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        Slett
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>
          )}

          {activeTab === 'orders' && (
            <section
              id="admin-panel-orders"
              role="tabpanel"
              aria-labelledby="admin-tab-orders"
              className="rounded-xl border border-sand bg-ivory p-6 shadow-nordic sm:p-7"
            >
              <h2 className="font-serif text-2xl font-semibold text-espresso">Bestillinger</h2>

              {ordersError && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-error/30 bg-canvas px-4 py-3 text-sm font-medium text-error"
                >
                  {ordersError}
                </div>
              )}

              {orders.length === 0 ? (
                <p className="mt-4 text-sm text-charcoal">Ingen bestillinger registrert ennå.</p>
              ) : (
                <div className="mt-5 space-y-4">
                  {orders.map((order) => {
                    const safeItems = Array.isArray(order.items) ? order.items : [];
                    const customerName = order.customer?.name ?? 'Ukjent kunde';
                    const customerEmail = order.customer?.email ?? '';
                    const postalCode = order.shippingAddress?.postalCode ?? '';
                    const city = order.shippingAddress?.city ?? '';
                    const locationLabel = [postalCode, city].filter(Boolean).join(' ');

                    return (
                      <article
                        key={order.id}
                        className="rounded-lg border border-sand bg-canvas p-4 sm:p-5"
                      >
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-sand pb-3">
                          <div className="min-w-0">
                            <p className="wrap-anywhere font-serif text-lg font-semibold text-espresso">
                              {order.orderNumber || order.id}
                            </p>
                            <p className="mt-0.5 wrap-anywhere text-xs text-taupe">
                              {customerName}
                              {customerEmail ? ` · ${customerEmail}` : ''}
                              {locationLabel ? ` · ${locationLabel}` : ''}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-espresso tabular-nums">
                              {formatNok(Number(order.totalNok) || 0)}
                            </p>
                            <p className="mt-0.5 text-xs text-taupe">
                              {order.paymentProvider || 'ukjent'} ·{' '}
                              {order.paymentStatus || 'ukjent'} · {formatDateNb(order.createdAt)}
                            </p>
                          </div>
                        </div>

                        <ul className="mt-3 space-y-1.5 text-xs text-charcoal">
                          {safeItems.map((item, idx) => {
                            const itemTitle = item?.title || item?.productId || `Vare ${idx + 1}`;
                            const qty = Number(item?.quantity) || 0;
                            const lineTotal = Number(item?.lineTotalNok) || 0;
                            return (
                              <li
                                key={`${order.id}-${idx}-${item?.productId ?? 'item'}`}
                                className="flex min-w-0 items-center justify-between gap-3"
                              >
                                <span className="min-w-0 wrap-anywhere">
                                  {qty} × {itemTitle}
                                </span>
                                <span className="shrink-0 font-medium text-espresso tabular-nums">
                                  {formatNok(lineTotal)}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {activeTab === 'messages' && (
            <section
              id="admin-panel-messages"
              role="tabpanel"
              aria-labelledby="admin-tab-messages"
              className="rounded-xl border border-sand bg-ivory p-6 shadow-nordic sm:p-7"
            >
              <h2 className="font-serif text-2xl font-semibold text-espresso">
                Kundehenvendelser
              </h2>

              {messagesError && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-error/30 bg-canvas px-4 py-3 text-sm font-medium text-error"
                >
                  {messagesError}
                </div>
              )}

              {messages.length === 0 ? (
                <p className="mt-4 text-sm text-charcoal">
                  Ingen henvendelser mottatt ennå.
                </p>
              ) : (
                <div className="mt-5 space-y-4">
                  {messages.map((msg) => (
                    <article
                      key={msg.id}
                      className="rounded-lg border border-sand bg-canvas p-4 sm:p-5"
                    >
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-sand pb-3">
                        <div className="min-w-0">
                          <h3 className="wrap-anywhere font-serif text-lg font-semibold text-espresso">
                            {msg.subject}
                          </h3>
                          <p className="mt-0.5 wrap-anywhere text-xs text-taupe">
                            {msg.name} · {msg.email}
                          </p>
                        </div>
                        <div className="text-right text-xs text-taupe">
                          <span className="rounded-full bg-linen px-2.5 py-0.5 font-semibold text-espresso">
                            {msg.status}
                          </span>
                          <p className="mt-1">{formatDateNb(msg.createdAt)}</p>
                        </div>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-charcoal">
                        {msg.message}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
