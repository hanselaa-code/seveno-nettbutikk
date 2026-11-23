import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { calculateIncludedMva, calculateShippingNok } from '../lib/format';
import { VALIDATION_LIMITS } from '../lib/validators';
import type { CartItem, Product } from '../types/domain';
import { useOptionalCatalog } from './CatalogContext';

export const CART_STORAGE_KEY = 'seveno_cart_v1';

export interface ResolvedCartItem {
  productId: string;
  quantity: number;
  product: Product | null;
  available: boolean;
  exceedsStock: boolean;
  unitPriceNok: number;
  lineTotalNok: number;
}

export interface CartContextValue {
  items: CartItem[];
  resolvedItems: ResolvedCartItem[];
  totalItems: number;
  subtotalNok: number;
  shippingNok: number;
  mvaNok: number;
  totalNok: number;
  maxDistinctItems: number;
  isAtMaxDistinctItems: boolean;
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  addItem: (productId: string, quantity?: number) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
}

export interface CartProviderProps {
  children: ReactNode;
  initialItems?: CartItem[];
  storageKey?: string;
  products?: Product[];
}

function sanitizeCartItems(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const merged = new Map<string, number>();

  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }

    const record = entry as { productId?: unknown; quantity?: unknown };
    const pid = typeof record.productId === 'string' ? record.productId.trim() : '';
    if (pid.length < 1 || pid.length > 120) {
      continue;
    }

    if (typeof record.quantity !== 'number' || !Number.isInteger(record.quantity)) {
      continue;
    }

    const qty = record.quantity;
    if (qty < 1) {
      continue;
    }

    const existing = merged.get(pid);
    if (existing === undefined) {
      if (merged.size >= VALIDATION_LIMITS.orderItemsMax) {
        continue;
      }
      merged.set(pid, Math.min(qty, VALIDATION_LIMITS.orderItemQtyMax));
    } else {
      merged.set(pid, Math.min(existing + qty, VALIDATION_LIMITS.orderItemQtyMax));
    }
  }

  return Array.from(merged.entries()).map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

function readCartFromStorage(storageKey: string): CartItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    return sanitizeCartItems(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeCartToStorage(storageKey: string, items: CartItem[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    // Ignorerer lagringsfeil i privat modus eller ved full kvote
  }
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({
  children,
  initialItems,
  storageKey = CART_STORAGE_KEY,
  products: productsProp,
}: CartProviderProps) {
  const optionalCatalog = useOptionalCatalog();
  const catalogProducts = productsProp ?? optionalCatalog?.products ?? [];

  const productById = useMemo(
    () => new Map(catalogProducts.map((product) => [product.id, product])),
    [catalogProducts],
  );

  const [items, setItems] = useState<CartItem[]>(() =>
    initialItems !== undefined ? sanitizeCartItems(initialItems) : readCartFromStorage(storageKey),
  );
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    writeCartToStorage(storageKey, items);
  }, [storageKey, items]);

  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  const addItem = useCallback(
    (productId: string, quantity = 1) => {
      const trimmedId = typeof productId === 'string' ? productId.trim() : '';
      const safeQty = Math.floor(quantity);
      if (!trimmedId || trimmedId.length > 120 || !Number.isFinite(safeQty) || safeQty < 1) {
        return;
      }

      const product = productById.get(trimmedId);
      if (product && (!product.active || product.stock <= 0)) {
        return;
      }

      const maxCap = product ? product.stock : VALIDATION_LIMITS.orderItemQtyMax;

      setItems((prev) => {
        const existingIndex = prev.findIndex((item) => item.productId === trimmedId);
        if (existingIndex === -1) {
          if (prev.length >= VALIDATION_LIMITS.orderItemsMax) {
            return prev;
          }
          const nextQty = Math.min(safeQty, maxCap);
          if (nextQty < 1) {
            return prev;
          }
          return [...prev, { productId: trimmedId, quantity: nextQty }];
        }

        const existing = prev[existingIndex];
        const merged = Math.min(existing.quantity + safeQty, maxCap);
        if (merged === existing.quantity) {
          return prev;
        }
        return prev.map((item, idx) =>
          idx === existingIndex ? { ...item, quantity: merged } : item,
        );
      });
    },
    [productById],
  );

  const updateQuantity = useCallback(
    (productId: string, quantity: number) => {
      const trimmedId = typeof productId === 'string' ? productId.trim() : '';
      const safeQty = Math.floor(quantity);
      if (!trimmedId || !Number.isFinite(safeQty)) {
        return;
      }

      if (safeQty <= 0) {
        setItems((prev) => prev.filter((item) => item.productId !== trimmedId));
        return;
      }

      const product = productById.get(trimmedId);
      if (product && (!product.active || product.stock <= 0)) {
        setItems((prev) => prev.filter((item) => item.productId !== trimmedId));
        return;
      }

      const maxCap = product ? product.stock : VALIDATION_LIMITS.orderItemQtyMax;
      const clamped = Math.min(safeQty, maxCap);

      setItems((prev) => {
        const exists = prev.some((item) => item.productId === trimmedId);
        if (!exists) {
          return prev;
        }
        return prev.map((item) =>
          item.productId === trimmedId ? { ...item, quantity: clamped } : item,
        );
      });
    },
    [productById],
  );

  const removeItem = useCallback((productId: string) => {
    const trimmedId = typeof productId === 'string' ? productId.trim() : '';
    if (!trimmedId) {
      return;
    }
    setItems((prev) => prev.filter((item) => item.productId !== trimmedId));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const resolvedItems = useMemo<ResolvedCartItem[]>(
    () =>
      items.map((item) => {
        const product = productById.get(item.productId) ?? null;
        const available = Boolean(product && product.active && product.stock > 0);
        const exceedsStock = Boolean(
          product && product.active && product.stock > 0 && item.quantity > product.stock,
        );
        const unitPriceNok = product ? product.priceNok : 0;
        const lineTotalNok = unitPriceNok * item.quantity;

        return {
          productId: item.productId,
          quantity: item.quantity,
          product,
          available,
          exceedsStock,
          unitPriceNok,
          lineTotalNok,
        };
      }),
    [items, productById],
  );

  const totalItems = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );

  const subtotalNok = useMemo(
    () => resolvedItems.reduce((sum, item) => sum + item.lineTotalNok, 0),
    [resolvedItems],
  );

  const shippingNok = useMemo(() => calculateShippingNok(subtotalNok), [subtotalNok]);
  const totalNok = useMemo(
    () => (subtotalNok > 0 ? subtotalNok + shippingNok : 0),
    [subtotalNok, shippingNok],
  );
  const mvaNok = useMemo(() => calculateIncludedMva(totalNok), [totalNok]);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      resolvedItems,
      totalItems,
      subtotalNok,
      shippingNok,
      mvaNok,
      totalNok,
      maxDistinctItems: VALIDATION_LIMITS.orderItemsMax,
      isAtMaxDistinctItems: items.length >= VALIDATION_LIMITS.orderItemsMax,
      isDrawerOpen,
      openDrawer,
      closeDrawer,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
    }),
    [
      items,
      resolvedItems,
      totalItems,
      subtotalNok,
      shippingNok,
      mvaNok,
      totalNok,
      isDrawerOpen,
      openDrawer,
      closeDrawer,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart må brukes innenfor en CartProvider.');
  }
  return ctx;
}

export function useOptionalCart(): CartContextValue | undefined {
  return useContext(CartContext);
}
