import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { db, isFirebaseConfigured } from '../lib/firebase';
import {
  LocalProductRepository,
  getProductRepository,
} from '../repositories/productRepository';
import type { IProductRepository } from '../repositories/productRepository';
import {
  clearCatalogIntentionallyEmptied,
  ensureAdminColdStartSeed,
  getStarterProducts,
  isCatalogIntentionallyEmptied,
  seedCatalog,
} from '../repositories/seedCatalog';
import { CATEGORIES } from '../types/domain';
import type { CategoryMeta, CategorySlug, Product } from '../types/domain';
import { useOptionalAuth } from './AuthContext';

export interface CatalogContextValue {
  products: Product[];
  categories: readonly CategoryMeta[];
  loading: boolean;
  error: string | null;
  isUsingFallback: boolean;
  refreshCatalog: () => Promise<void>;
  getProductByIdOrSlug: (idOrSlug: string) => Product | undefined;
  getProductsByCategory: (categorySlug: CategorySlug | 'alle' | string) => Product[];
  resolveProductByIdOrSlug: (idOrSlug: string) => Promise<Product | null>;
}

export interface CatalogProviderProps {
  children: ReactNode;
  productRepository?: IProductRepository;
}

const CatalogContext = createContext<CatalogContextValue | undefined>(undefined);

export function CatalogProvider({ children, productRepository }: CatalogProviderProps) {
  const initialRepo = productRepository ?? getProductRepository();
  const hasRemoteSource = productRepository
    ? !(productRepository instanceof LocalProductRepository)
    : Boolean(
        isFirebaseConfigured() &&
          db !== null &&
          !(initialRepo instanceof LocalProductRepository),
      );

  const [products, setProducts] = useState<Product[]>(() => {
    if (hasRemoteSource) {
      return [];
    }
    return initialRepo instanceof LocalProductRepository
      ? initialRepo.listActiveSync()
      : getStarterProducts();
  });
  const [loading, setLoading] = useState<boolean>(hasRemoteSource);
  const [error, setError] = useState<string | null>(null);
  const [isUsingFallback, setIsUsingFallback] = useState<boolean>(!hasRemoteSource);

  const optionalAuth = useOptionalAuth();
  const authLoading = optionalAuth?.loading ?? false;
  const isAuthorizedAdmin = Boolean(
    optionalAuth?.user && !optionalAuth.user.isAnonymous && optionalAuth.isAdmin,
  );

  const isMountedRef = useRef(true);
  const loadRequestIdRef = useRef(0);
  const hasAttemptedUnauthSeedRef = useRef(false);
  const hasAttemptedAdminSeedRef = useRef(false);
  const hasConfirmedCatalogRef = useRef(false);
  const unauthSeedFailedRef = useRef(false);
  const hasStartedInitialLoadRef = useRef(false);
  const authLoadingRef = useRef(authLoading);
  authLoadingRef.current = authLoading;
  const isAuthorizedAdminRef = useRef(isAuthorizedAdmin);
  isAuthorizedAdminRef.current = isAuthorizedAdmin;
  const prevAuthLoadingRef = useRef(authLoading);
  const prevIsAuthorizedAdminRef = useRef(isAuthorizedAdmin);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const resolveRepository = useCallback((): IProductRepository => {
    if (productRepository) {
      return productRepository;
    }
    return getProductRepository();
  }, [productRepository]);

  const loadCatalog = useCallback(
    async (options?: { allowInitialSeed?: boolean }) => {
      const requestId = ++loadRequestIdRef.current;
      const repo = resolveRepository();
      if (repo instanceof LocalProductRepository) {
        const active = await repo.listActive();
        if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
        setProducts(active);
        setLoading(false);
        setIsUsingFallback(true);
        setError(null);
        return;
      }

      if (isMountedRef.current) {
        setLoading(true);
        setError(null);
      }

      let waitingForAuthSettlement = false;

      try {
        let active = await repo.listActive();
        if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;

        if (active.length > 0) {
          clearCatalogIntentionallyEmptied();
          hasConfirmedCatalogRef.current = true;
          hasAttemptedAdminSeedRef.current = true;
          unauthSeedFailedRef.current = false;
        } else if (isCatalogIntentionallyEmptied()) {
          hasConfirmedCatalogRef.current = true;
          unauthSeedFailedRef.current = false;
        } else if (
          !isAuthorizedAdminRef.current &&
          authLoadingRef.current &&
          options?.allowInitialSeed === true
        ) {
          waitingForAuthSettlement = true;
          return;
        } else if (options?.allowInitialSeed === true) {
          if (isAuthorizedAdminRef.current) {
            if (!hasAttemptedAdminSeedRef.current) {
              hasAttemptedAdminSeedRef.current = true;
              try {
                const seedResult = await ensureAdminColdStartSeed(repo);
                if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
                hasConfirmedCatalogRef.current = true;
                unauthSeedFailedRef.current = false;
                if (seedResult.seeded || seedResult.products.some((p) => p.active)) {
                  active = await repo.listActive();
                  if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
                }
              } catch {
                if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
                setProducts(getStarterProducts());
                setIsUsingFallback(true);
                setError(null);
                return;
              }
            }
          } else if (!hasAttemptedUnauthSeedRef.current) {
            hasAttemptedUnauthSeedRef.current = true;
            try {
              const seedResult = await seedCatalog(repo);
              if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
              hasConfirmedCatalogRef.current = true;
              unauthSeedFailedRef.current = false;
              if (seedResult.created > 0 || seedResult.products.some((p) => p.active)) {
                active = await repo.listActive();
                if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
              }
            } catch {
              if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
              unauthSeedFailedRef.current = true;
              setProducts(getStarterProducts());
              setIsUsingFallback(true);
              setError(null);
              return;
            }
          } else if (unauthSeedFailedRef.current) {
            setProducts(getStarterProducts());
            setIsUsingFallback(true);
            setError(null);
            return;
          }
        } else if (!isAuthorizedAdminRef.current && unauthSeedFailedRef.current) {
          setProducts(getStarterProducts());
          setIsUsingFallback(true);
          setError(null);
          return;
        }

        if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
        setProducts(active);
        setIsUsingFallback(false);
        setError(null);
      } catch {
        if (!isMountedRef.current || requestId !== loadRequestIdRef.current) return;
        setProducts(getStarterProducts());
        setIsUsingFallback(true);
        setError(null);
      } finally {
        if (
          !waitingForAuthSettlement &&
          isMountedRef.current &&
          requestId === loadRequestIdRef.current
        ) {
          setLoading(false);
        }
      }
    },
    [resolveRepository],
  );

  const refreshCatalog = useCallback(async () => {
    if (!authLoadingRef.current) {
      hasAttemptedUnauthSeedRef.current = true;
    }
    if (isAuthorizedAdminRef.current) {
      hasAttemptedAdminSeedRef.current = true;
    }
    await loadCatalog({ allowInitialSeed: false });
  }, [loadCatalog]);

  useEffect(() => {
    if (!hasRemoteSource) {
      const repo = resolveRepository();
      if (repo instanceof LocalProductRepository) {
        setProducts(repo.listActiveSync());
        setLoading(false);
        setIsUsingFallback(true);
        setError(null);
      }
      return;
    }

    const wasAuthLoading = prevAuthLoadingRef.current;
    const wasAuthorizedAdmin = prevIsAuthorizedAdminRef.current;
    prevAuthLoadingRef.current = authLoading;
    prevIsAuthorizedAdminRef.current = isAuthorizedAdmin;

    if (!hasStartedInitialLoadRef.current) {
      hasStartedInitialLoadRef.current = true;
      void loadCatalog({ allowInitialSeed: true });
      return;
    }

    if (authLoading) {
      return;
    }

    const authJustSettled = wasAuthLoading && !authLoading;
    const adminJustElevated = !wasAuthorizedAdmin && isAuthorizedAdmin;

    if (adminJustElevated && !hasAttemptedAdminSeedRef.current) {
      void loadCatalog({ allowInitialSeed: true });
      return;
    }

    if (authJustSettled && !hasConfirmedCatalogRef.current) {
      void loadCatalog({ allowInitialSeed: true });
    }
  }, [authLoading, hasRemoteSource, isAuthorizedAdmin, loadCatalog, resolveRepository]);

  const getProductByIdOrSlug = useCallback(
    (idOrSlug: string): Product | undefined => {
      const trimmed = idOrSlug.trim();
      if (!trimmed) {
        return undefined;
      }
      return products.find((product) => product.id === trimmed || product.slug === trimmed);
    },
    [products],
  );

  const getProductsByCategory = useCallback(
    (categorySlug: CategorySlug | 'alle' | string): Product[] => {
      if (!categorySlug || categorySlug === 'alle') {
        return products;
      }
      return products.filter((product) => product.categorySlug === categorySlug);
    },
    [products],
  );

  const resolveProductByIdOrSlug = useCallback(
    async (idOrSlug: string): Promise<Product | null> => {
      const trimmed = idOrSlug.trim();
      if (!trimmed || trimmed.includes('/')) {
        return null;
      }

      const localMatch = getProductByIdOrSlug(trimmed);
      if (localMatch) {
        return localMatch;
      }

      const repo = resolveRepository();
      if (!repo) {
        return null;
      }

      try {
        const bySlug = await repo.getBySlug(trimmed);
        if (bySlug && bySlug.active) {
          return bySlug;
        }
        const byId = await repo.getById(trimmed);
        if (byId && byId.active) {
          return byId;
        }
        return null;
      } catch {
        return null;
      }
    },
    [getProductByIdOrSlug, resolveRepository],
  );

  const value = useMemo<CatalogContextValue>(
    () => ({
      products,
      categories: CATEGORIES,
      loading,
      error,
      isUsingFallback,
      refreshCatalog,
      getProductByIdOrSlug,
      getProductsByCategory,
      resolveProductByIdOrSlug,
    }),
    [
      products,
      loading,
      error,
      isUsingFallback,
      refreshCatalog,
      getProductByIdOrSlug,
      getProductsByCategory,
      resolveProductByIdOrSlug,
    ],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) {
    throw new Error('useCatalog må brukes innenfor en CatalogProvider.');
  }
  return ctx;
}

export function useOptionalCatalog(): CatalogContextValue | undefined {
  return useContext(CatalogContext);
}
