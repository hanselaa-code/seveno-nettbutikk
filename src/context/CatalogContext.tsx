import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { db, isFirebaseConfigured } from '../lib/firebase';
import {
  LocalProductRepository,
  getProductRepository,
} from '../repositories/productRepository';
import type { IProductRepository } from '../repositories/productRepository';
import { getStarterProducts, seedCatalog } from '../repositories/seedCatalog';
import { CATEGORIES } from '../types/domain';
import type { CategoryMeta, CategorySlug, Product } from '../types/domain';

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

  const isMountedRef = useRef(true);
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

  const loadCatalog = useCallback(async () => {
    const repo = resolveRepository();
    if (repo instanceof LocalProductRepository) {
      const active = await repo.listActive();
      if (!isMountedRef.current) return;
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

    try {
      let active = await repo.listActive();

      if (active.length === 0) {
        try {
          await seedCatalog(repo);
          active = await repo.listActive();
        } catch {
          if (!isMountedRef.current) return;
          setProducts(getStarterProducts());
          setIsUsingFallback(true);
          setError(null);
          return;
        }
      }

      if (!isMountedRef.current) return;
      if (active.length > 0) {
        setProducts(active);
        setIsUsingFallback(false);
        setError(null);
      } else {
        setProducts(getStarterProducts());
        setIsUsingFallback(true);
        setError(null);
      }
    } catch {
      if (!isMountedRef.current) return;
      setProducts(getStarterProducts());
      setIsUsingFallback(true);
      setError(null);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [resolveRepository]);

  useEffect(() => {
    if (hasRemoteSource) {
      void loadCatalog();
      return;
    }
    const repo = resolveRepository();
    if (repo instanceof LocalProductRepository) {
      setProducts(repo.listActiveSync());
      setLoading(false);
      setIsUsingFallback(true);
      setError(null);
    }
  }, [hasRemoteSource, loadCatalog, resolveRepository]);

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
      refreshCatalog: loadCatalog,
      getProductByIdOrSlug,
      getProductsByCategory,
      resolveProductByIdOrSlug,
    }),
    [
      products,
      loading,
      error,
      isUsingFallback,
      loadCatalog,
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
