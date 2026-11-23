import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { db, getDb, isFirebaseConfigured } from '../lib/firebase';
import { ValidationError, validateProductInput } from '../lib/validators';
import { CATEGORY_MAP } from '../types/domain';
import type {
  CategorySlug,
  CreateProductInput,
  Product,
  UpdateProductInput,
} from '../types/domain';
import { getStarterProducts } from './seedCatalog';
import { assertBrowserOnline, runFirestoreWriteWithTimeout } from './firestoreUtils';

export interface IProductRepository {
  listAll(): Promise<Product[]>;
  listActive(): Promise<Product[]>;
  listByCategory(categorySlug: CategorySlug): Promise<Product[]>;
  getById(id: string): Promise<Product | null>;
  getBySlug(slug: string): Promise<Product | null>;
  create(input: CreateProductInput): Promise<Product>;
  update(id: string, input: UpdateProductInput): Promise<Product>;
  delete(id: string): Promise<void>;
}

function toIsoString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

function mapDocToProduct(id: string, data: Record<string, unknown>): Product {
  const categorySlug = data.categorySlug as CategorySlug;
  const fallbackCategoryName = CATEGORY_MAP[categorySlug]?.name ?? 'Seveno living';

  return {
    id,
    slug: String(data.slug ?? id),
    title: String(data.title ?? ''),
    categorySlug,
    categoryName: (data.categoryName as Product['categoryName']) ?? fallbackCategoryName,
    description: String(data.description ?? ''),
    priceNok: Number(data.priceNok ?? 0),
    stock: Number(data.stock ?? 0),
    imageUrl: String(data.imageUrl ?? '/images/products/seveno-default.svg'),
    specs: Array.isArray(data.specs) ? data.specs.map(String) : [],
    active: Boolean(data.active),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

function normalizeDocId(id: string): string | null {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/')) {
    return null;
  }
  return trimmed;
}

export class FirestoreProductRepository implements IProductRepository {
  private readonly db: Firestore;

  constructor(db: Firestore = getDb()) {
    this.db = db;
  }

  async listAll(): Promise<Product[]> {
    const q = query(collection(this.db, 'products'), orderBy('title', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) =>
      mapDocToProduct(docSnap.id, docSnap.data() as Record<string, unknown>),
    );
  }

  async listActive(): Promise<Product[]> {
    const q = query(
      collection(this.db, 'products'),
      where('active', '==', true),
      orderBy('title', 'asc'),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) =>
      mapDocToProduct(docSnap.id, docSnap.data() as Record<string, unknown>),
    );
  }

  async listByCategory(categorySlug: CategorySlug): Promise<Product[]> {
    const q = query(
      collection(this.db, 'products'),
      where('active', '==', true),
      where('categorySlug', '==', categorySlug),
      orderBy('title', 'asc'),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) =>
      mapDocToProduct(docSnap.id, docSnap.data() as Record<string, unknown>),
    );
  }

  async getById(id: string): Promise<Product | null> {
    const trimmed = normalizeDocId(id);
    if (!trimmed) {
      return null;
    }
    const docSnap = await getDoc(doc(this.db, 'products', trimmed));
    if (!docSnap.exists()) {
      return null;
    }
    return mapDocToProduct(docSnap.id, docSnap.data() as Record<string, unknown>);
  }

  async getBySlug(slug: string): Promise<Product | null> {
    const trimmed = normalizeDocId(slug);
    if (!trimmed) {
      return null;
    }
    const q = query(
      collection(this.db, 'products'),
      where('active', '==', true),
      where('slug', '==', trimmed),
      limit(1),
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const first = snapshot.docs[0];
      return mapDocToProduct(first.id, first.data() as Record<string, unknown>);
    }

    try {
      const byId = await this.getById(trimmed);
      if (byId && byId.active === true) {
        return byId;
      }
      return null;
    } catch (error) {
      const code =
        error !== null && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (
        code === 'permission-denied' ||
        code.endsWith('/permission-denied') ||
        (error instanceof Error && /permission-denied/i.test(error.message))
      ) {
        return null;
      }
      throw error;
    }
  }

  async create(input: CreateProductInput): Promise<Product> {
    const validation = validateProductInput(input);
    if (!validation.valid || !validation.value) {
      throw new ValidationError('Ugyldig produktdata.', validation.errors);
    }

    const normalized = validation.value;
    const categoryName = CATEGORY_MAP[normalized.categorySlug].name;
    const nowIso = new Date().toISOString();

    const docRef = normalized.id
      ? doc(this.db, 'products', normalized.id)
      : doc(collection(this.db, 'products'));

    const firestorePayload = {
      slug: normalized.slug,
      title: normalized.title,
      categorySlug: normalized.categorySlug,
      categoryName,
      description: normalized.description,
      priceNok: normalized.priceNok,
      stock: normalized.stock,
      imageUrl: normalized.imageUrl,
      specs: normalized.specs,
      active: normalized.active,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await runFirestoreWriteWithTimeout(() => setDoc(docRef, firestorePayload));

    return {
      id: docRef.id,
      slug: normalized.slug,
      title: normalized.title,
      categorySlug: normalized.categorySlug,
      categoryName,
      description: normalized.description,
      priceNok: normalized.priceNok,
      stock: normalized.stock,
      imageUrl: normalized.imageUrl,
      specs: normalized.specs,
      active: normalized.active,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  async update(id: string, input: UpdateProductInput): Promise<Product> {
    assertBrowserOnline();
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Produkt med ID "${id}" ble ikke funnet.`);
    }

    const merged: CreateProductInput = {
      slug: input.slug ?? existing.slug,
      title: input.title ?? existing.title,
      categorySlug: input.categorySlug ?? existing.categorySlug,
      description: input.description ?? existing.description,
      priceNok: input.priceNok ?? existing.priceNok,
      stock: input.stock ?? existing.stock,
      imageUrl: input.imageUrl ?? existing.imageUrl,
      specs: input.specs ?? existing.specs,
      active: input.active ?? existing.active,
    };

    const validation = validateProductInput(merged);
    if (!validation.valid || !validation.value) {
      throw new ValidationError('Ugyldig produktdata ved oppdatering.', validation.errors);
    }

    const normalized = validation.value;
    const categoryName = CATEGORY_MAP[normalized.categorySlug].name;
    const nowIso = new Date().toISOString();

    const docRef = doc(this.db, 'products', existing.id);
    await runFirestoreWriteWithTimeout(() =>
      updateDoc(docRef, {
        slug: normalized.slug,
        title: normalized.title,
        categorySlug: normalized.categorySlug,
        categoryName,
        description: normalized.description,
        priceNok: normalized.priceNok,
        stock: normalized.stock,
        imageUrl: normalized.imageUrl,
        specs: normalized.specs,
        active: normalized.active,
        updatedAt: serverTimestamp(),
      }),
    );

    return {
      id: existing.id,
      slug: normalized.slug,
      title: normalized.title,
      categorySlug: normalized.categorySlug,
      categoryName,
      description: normalized.description,
      priceNok: normalized.priceNok,
      stock: normalized.stock,
      imageUrl: normalized.imageUrl,
      specs: normalized.specs,
      active: normalized.active,
      createdAt: existing.createdAt,
      updatedAt: nowIso,
    };
  }

  async delete(id: string): Promise<void> {
    const trimmed = normalizeDocId(id);
    if (!trimmed) {
      throw new Error('Ugyldig produkt-ID.');
    }
    await runFirestoreWriteWithTimeout(() => deleteDoc(doc(this.db, 'products', trimmed)));
  }
}

const DEFAULT_LOCAL_PRODUCT_STORAGE_KEY = 'seveno_products_v1';

function isStoredProduct(item: unknown): item is Product {
  if (item === null || typeof item !== 'object') {
    return false;
  }
  const candidate = item as Product;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.slug === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.categorySlug === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.priceNok === 'number' &&
    typeof candidate.stock === 'number' &&
    typeof candidate.imageUrl === 'string' &&
    Array.isArray(candidate.specs) &&
    candidate.specs.every((spec) => typeof spec === 'string') &&
    typeof candidate.active === 'boolean'
  );
}

function readLocalProductsRaw(storageKey: string): Product[] | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed.filter(isStoredProduct);
  } catch {
    return null;
  }
}

function writeLocalProductsRaw(storageKey: string, products: Product[]): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(products));
    return true;
  } catch {
    return false;
  }
}

export class LocalProductRepository implements IProductRepository {
  private readonly storageKey: string;
  private memoryStore: Product[] | null = null;
  private storageWriteFailed = false;
  private sequence = 0;

  constructor(storageKey: string = DEFAULT_LOCAL_PRODUCT_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  private readStore(): Product[] {
    if (typeof window !== 'undefined' && !this.storageWriteFailed) {
      const fromStorage = readLocalProductsRaw(this.storageKey);
      if (fromStorage !== null) {
        this.memoryStore = [...fromStorage];
        return [...fromStorage];
      }

      const seeded = getStarterProducts();
      this.memoryStore = [...seeded];
      const wrote = writeLocalProductsRaw(this.storageKey, seeded);
      if (!wrote) {
        this.storageWriteFailed = true;
      }
      return [...seeded];
    }

    if (this.memoryStore === null) {
      this.memoryStore = getStarterProducts();
    }
    return [...this.memoryStore];
  }

  private writeStore(products: Product[]): void {
    this.memoryStore = [...products];
    const wrote = writeLocalProductsRaw(this.storageKey, products);
    if (!wrote) {
      this.storageWriteFailed = true;
    }
  }

  listActiveSync(): Product[] {
    return this.readStore()
      .filter((product) => product.active)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async listAll(): Promise<Product[]> {
    return this.readStore().sort((a, b) => a.title.localeCompare(b.title));
  }

  async listActive(): Promise<Product[]> {
    return this.listActiveSync();
  }

  async listByCategory(categorySlug: CategorySlug): Promise<Product[]> {
    return this.readStore()
      .filter((product) => product.active && product.categorySlug === categorySlug)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async getById(id: string): Promise<Product | null> {
    const trimmed = normalizeDocId(id);
    if (!trimmed) {
      return null;
    }
    return this.readStore().find((product) => product.id === trimmed) ?? null;
  }

  async getBySlug(slug: string): Promise<Product | null> {
    const trimmed = normalizeDocId(slug);
    if (!trimmed) {
      return null;
    }
    const products = this.readStore();
    return (
      products.find((product) => product.active && product.slug === trimmed) ??
      products.find((product) => product.active && product.id === trimmed) ??
      null
    );
  }

  async create(input: CreateProductInput): Promise<Product> {
    const validation = validateProductInput(input);
    if (!validation.valid || !validation.value) {
      throw new ValidationError('Ugyldig produktdata.', validation.errors);
    }

    const normalized = validation.value;
    const categoryName = CATEGORY_MAP[normalized.categorySlug].name;
    const nowIso = new Date().toISOString();
    this.sequence += 1;
    const id = normalized.id ?? `local-prod-${Date.now()}-${this.sequence}`;

    const product: Product = {
      id,
      slug: normalized.slug,
      title: normalized.title,
      categorySlug: normalized.categorySlug,
      categoryName,
      description: normalized.description,
      priceNok: normalized.priceNok,
      stock: normalized.stock,
      imageUrl: normalized.imageUrl,
      specs: [...normalized.specs],
      active: normalized.active,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const existing = this.readStore();
    if (existing.some((item) => item.id !== id && item.slug === normalized.slug)) {
      throw new ValidationError('Et produkt med denne URL-slugen finnes allerede.', {
        slug: `URL-slug "${normalized.slug}" er allerede i bruk av et annet produkt.`,
      });
    }
    const updated = [...existing.filter((item) => item.id !== id), product];
    this.writeStore(updated);

    return product;
  }

  async update(id: string, input: UpdateProductInput): Promise<Product> {
    const trimmed = normalizeDocId(id);
    if (!trimmed) {
      throw new Error(`Produkt med ID "${id}" ble ikke funnet.`);
    }

    const existingList = this.readStore();
    const existing = existingList.find((product) => product.id === trimmed);
    if (!existing) {
      throw new Error(`Produkt med ID "${id}" ble ikke funnet.`);
    }

    const merged: CreateProductInput = {
      slug: input.slug ?? existing.slug,
      title: input.title ?? existing.title,
      categorySlug: input.categorySlug ?? existing.categorySlug,
      description: input.description ?? existing.description,
      priceNok: input.priceNok ?? existing.priceNok,
      stock: input.stock ?? existing.stock,
      imageUrl: input.imageUrl ?? existing.imageUrl,
      specs: input.specs ?? existing.specs,
      active: input.active ?? existing.active,
    };

    const validation = validateProductInput(merged);
    if (!validation.valid || !validation.value) {
      throw new ValidationError('Ugyldig produktdata ved oppdatering.', validation.errors);
    }

    const normalized = validation.value;
    if (existingList.some((item) => item.id !== existing.id && item.slug === normalized.slug)) {
      throw new ValidationError('Et produkt med denne URL-slugen finnes allerede.', {
        slug: `URL-slug "${normalized.slug}" er allerede i bruk av et annet produkt.`,
      });
    }
    const categoryName = CATEGORY_MAP[normalized.categorySlug].name;
    const nowIso = new Date().toISOString();

    const updatedProduct: Product = {
      id: existing.id,
      slug: normalized.slug,
      title: normalized.title,
      categorySlug: normalized.categorySlug,
      categoryName,
      description: normalized.description,
      priceNok: normalized.priceNok,
      stock: normalized.stock,
      imageUrl: normalized.imageUrl,
      specs: [...normalized.specs],
      active: normalized.active,
      createdAt: existing.createdAt,
      updatedAt: nowIso,
    };

    const nextList = existingList.map((item) => (item.id === existing.id ? updatedProduct : item));
    this.writeStore(nextList);

    return updatedProduct;
  }

  async delete(id: string): Promise<void> {
    const trimmed = normalizeDocId(id);
    if (!trimmed) {
      throw new Error('Ugyldig produkt-ID.');
    }
    const existingList = this.readStore();
    const nextList = existingList.filter((item) => item.id !== trimmed);
    this.writeStore(nextList);
  }
}

const firestoreProductRepoCache = new WeakMap<Firestore, FirestoreProductRepository>();
const localProductRepoSingleton = new LocalProductRepository();

export function getProductRepository(): IProductRepository {
  if (isFirebaseConfigured() && db !== null) {
    let cached = firestoreProductRepoCache.get(db);
    if (!cached) {
      cached = new FirestoreProductRepository(db);
      firestoreProductRepoCache.set(db, cached);
    }
    return cached;
  }
  return localProductRepoSingleton;
}
