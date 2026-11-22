import type { Auth } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
  auth,
  db,
  ensureAnonymousUserUid,
  getDb,
  isFirebaseConfigured,
} from '../lib/firebase';
import {
  calculateIncludedMva,
  calculateShippingNok,
  generateOrderNumber,
} from '../lib/format';
import { ValidationError, validateOrderInput } from '../lib/validators';
import type {
  CreateOrderInput,
  Order,
  OrderItem,
  OrderPaymentStatus,
  OrderStatus,
  Product,
} from '../types/domain';
import { FirestoreProductRepository, getProductRepository } from './productRepository';
import type { IProductRepository } from './productRepository';

export interface IOrderRepository {
  create(input: CreateOrderInput): Promise<Order>;
  getById(id: string): Promise<Order | null>;
  listByOwner(ownerUid: string): Promise<Order[]>;
  listAll(): Promise<Order[]>;
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

function mapDocToOrder(id: string, data: Record<string, unknown>): Order {
  return {
    id,
    orderNumber: String(data.orderNumber ?? ''),
    ownerUid: String(data.ownerUid ?? ''),
    customer: data.customer as Order['customer'],
    shippingAddress: data.shippingAddress as Order['shippingAddress'],
    items: Array.isArray(data.items) ? (data.items as OrderItem[]) : [],
    subtotalNok: Number(data.subtotalNok ?? 0),
    shippingNok: Number(data.shippingNok ?? 0),
    mvaNok: Number(data.mvaNok ?? 0),
    totalNok: Number(data.totalNok ?? 0),
    paymentProvider: data.paymentProvider as Order['paymentProvider'],
    paymentReference: String(data.paymentReference ?? ''),
    paymentStatus: data.paymentStatus as OrderPaymentStatus,
    status: data.status as OrderStatus,
    createdAt: toIsoString(data.createdAt),
  };
}

function normalizeDocId(id: string): string | null {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/')) {
    return null;
  }
  return trimmed;
}

function isPermissionDeniedError(error: unknown): boolean {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  return (
    code === 'permission-denied' ||
    code.endsWith('/permission-denied') ||
    (error instanceof Error && /permission-denied/i.test(error.message))
  );
}

async function buildValidatedOrderPayload(
  input: CreateOrderInput,
  productRepo: Pick<IProductRepository, 'getById'>,
): Promise<{
  validated: CreateOrderInput;
  orderItems: OrderItem[];
  subtotalNok: number;
  shippingNok: number;
  mvaNok: number;
  totalNok: number;
  orderNumber: string;
  paymentReference: string;
  paymentStatus: OrderPaymentStatus;
  status: OrderStatus;
  nowIso: string;
}> {
  const validation = validateOrderInput(input);
  if (!validation.valid || !validation.value) {
    throw new ValidationError('Ugyldig bestillingsinformasjon.', validation.errors);
  }

  const validated = validation.value;
  const orderItems: OrderItem[] = [];
  let subtotalNok = 0;

  for (const cartItem of validated.items) {
    let product: Product | null = null;
    try {
      product = await productRepo.getById(cartItem.productId);
    } catch (error) {
      if (!isPermissionDeniedError(error)) {
        throw error;
      }
      product = null;
    }

    if (!product || !product.active) {
      throw new ValidationError(
        `Produktet "${cartItem.productId}" er ikke tilgjengelig.`,
        { items: `Produktet "${cartItem.productId}" er ikke lenger tilgjengelig.` },
      );
    }
    if (product.stock < cartItem.quantity) {
      throw new ValidationError(
        `Utilstrekkelig lagerbeholdning for "${product.title}".`,
        {
          items: `Bare ${product.stock} stk på lager for "${product.title}".`,
        },
      );
    }

    const unitPriceNok = product.priceNok;
    const lineTotalNok = unitPriceNok * cartItem.quantity;
    subtotalNok += lineTotalNok;

    orderItems.push({
      productId: product.id,
      title: product.title,
      quantity: cartItem.quantity,
      unitPriceNok,
      lineTotalNok,
    });
  }

  const shippingNok = calculateShippingNok(subtotalNok);
  const totalNok = subtotalNok + shippingNok;
  const mvaNok = calculateIncludedMva(totalNok);
  const orderNumber = generateOrderNumber();
  const paymentReference = validated.paymentReference || orderNumber;
  const paymentStatus: OrderPaymentStatus =
    validated.paymentStatus ??
    (validated.paymentProvider === 'test_order' ? 'paid_test' : 'pending_provider');
  const status: OrderStatus = 'confirmed';
  const nowIso = new Date().toISOString();

  return {
    validated,
    orderItems,
    subtotalNok,
    shippingNok,
    mvaNok,
    totalNok,
    orderNumber,
    paymentReference,
    paymentStatus,
    status,
    nowIso,
  };
}

export class FirestoreOrderRepository implements IOrderRepository {
  private readonly db: Firestore;
  private readonly productRepo: IProductRepository;

  constructor(db: Firestore = getDb(), productRepo?: IProductRepository) {
    this.db = db;
    this.productRepo = productRepo ?? new FirestoreProductRepository(db);
  }

  async create(input: CreateOrderInput): Promise<Order> {
    const built = await buildValidatedOrderPayload(input, this.productRepo);
    const docRef = doc(collection(this.db, 'orders'));

    await setDoc(docRef, {
      orderNumber: built.orderNumber,
      ownerUid: built.validated.ownerUid,
      customer: built.validated.customer,
      shippingAddress: built.validated.shippingAddress,
      items: built.orderItems,
      subtotalNok: built.subtotalNok,
      shippingNok: built.shippingNok,
      mvaNok: built.mvaNok,
      totalNok: built.totalNok,
      paymentProvider: built.validated.paymentProvider,
      paymentReference: built.paymentReference,
      paymentStatus: built.paymentStatus,
      status: built.status,
      createdAt: serverTimestamp(),
    });

    return {
      id: docRef.id,
      orderNumber: built.orderNumber,
      ownerUid: built.validated.ownerUid,
      customer: built.validated.customer,
      shippingAddress: built.validated.shippingAddress,
      items: built.orderItems,
      subtotalNok: built.subtotalNok,
      shippingNok: built.shippingNok,
      mvaNok: built.mvaNok,
      totalNok: built.totalNok,
      paymentProvider: built.validated.paymentProvider,
      paymentReference: built.paymentReference,
      paymentStatus: built.paymentStatus,
      status: built.status,
      createdAt: built.nowIso,
    };
  }

  async getById(id: string): Promise<Order | null> {
    const trimmed = normalizeDocId(id);
    if (!trimmed) {
      return null;
    }
    const docSnap = await getDoc(doc(this.db, 'orders', trimmed));
    if (!docSnap.exists()) {
      return null;
    }
    return mapDocToOrder(docSnap.id, docSnap.data() as Record<string, unknown>);
  }

  async listByOwner(ownerUid: string): Promise<Order[]> {
    const trimmedOwner = typeof ownerUid === 'string' ? ownerUid.trim() : '';
    if (!trimmedOwner) {
      return [];
    }
    const q = query(
      collection(this.db, 'orders'),
      where('ownerUid', '==', trimmedOwner),
      orderBy('createdAt', 'desc'),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) =>
      mapDocToOrder(docSnap.id, docSnap.data() as Record<string, unknown>),
    );
  }

  async listAll(): Promise<Order[]> {
    const q = query(collection(this.db, 'orders'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) =>
      mapDocToOrder(docSnap.id, docSnap.data() as Record<string, unknown>),
    );
  }
}

const DEFAULT_LOCAL_ORDER_STORAGE_KEY = 'seveno_orders_v1';
const LOCAL_GUEST_UID_STORAGE_KEY = 'seveno_guest_uid_v1';
let localGuestUidFallback: string | null = null;

function readLocalOrders(storageKey: string): Order[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is Order =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as Order).id === 'string' &&
        typeof (item as Order).orderNumber === 'string' &&
        typeof (item as Order).ownerUid === 'string',
    );
  } catch {
    return [];
  }
}

function writeLocalOrders(storageKey: string, orders: Order[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(orders));
  } catch {
    // Ignorerer lagringsfeil i privat modus eller ved full kvote
  }
}

function createStarterOrderProductLookup(): Pick<IProductRepository, 'getById'> {
  return {
    async getById(id: string): Promise<Product | null> {
      const normalized = normalizeDocId(id);
      if (!normalized) {
        return null;
      }
      const repo = getProductRepository();
      const byId = await repo.getById(normalized);
      if (byId) {
        return byId;
      }
      const bySlug = await repo.getBySlug(normalized);
      if (bySlug) {
        return bySlug;
      }
      return null;
    },
  };
}

export class LocalOrderRepository implements IOrderRepository {
  private readonly storageKey: string;
  private readonly productRepo: Pick<IProductRepository, 'getById'>;
  private readonly memoryStore: Order[] = [];
  private sequence = 0;

  constructor(
    storageKey: string = DEFAULT_LOCAL_ORDER_STORAGE_KEY,
    productRepo?: Pick<IProductRepository, 'getById'>,
  ) {
    this.storageKey = storageKey;
    this.productRepo = productRepo ?? createStarterOrderProductLookup();
  }

  private getMergedOrders(): Order[] {
    const stored = readLocalOrders(this.storageKey);
    const byId = new Map<string, Order>();

    for (const item of this.memoryStore) {
      byId.set(item.id, item);
    }
    for (const item of stored) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }

    return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(input: CreateOrderInput): Promise<Order> {
    const built = await buildValidatedOrderPayload(input, this.productRepo);
    this.sequence += 1;

    const order: Order = {
      id: `local-order-${Date.now()}-${this.sequence}`,
      orderNumber: built.orderNumber,
      ownerUid: built.validated.ownerUid,
      customer: built.validated.customer,
      shippingAddress: built.validated.shippingAddress,
      items: built.orderItems,
      subtotalNok: built.subtotalNok,
      shippingNok: built.shippingNok,
      mvaNok: built.mvaNok,
      totalNok: built.totalNok,
      paymentProvider: built.validated.paymentProvider,
      paymentReference: built.paymentReference,
      paymentStatus: built.paymentStatus,
      status: built.status,
      createdAt: built.nowIso,
    };

    this.memoryStore.unshift(order);
    const existing = readLocalOrders(this.storageKey);
    const merged = [order, ...existing.filter((item) => item.id !== order.id)];
    writeLocalOrders(this.storageKey, merged);

    return order;
  }

  async getById(id: string): Promise<Order | null> {
    const normalized = normalizeDocId(id);
    if (!normalized) {
      return null;
    }
    return this.getMergedOrders().find((order) => order.id === normalized) ?? null;
  }

  async listByOwner(ownerUid: string): Promise<Order[]> {
    const trimmedOwner = typeof ownerUid === 'string' ? ownerUid.trim() : '';
    if (!trimmedOwner) {
      return [];
    }
    return this.getMergedOrders().filter((order) => order.ownerUid === trimmedOwner);
  }

  async listAll(): Promise<Order[]> {
    return this.getMergedOrders();
  }
}

const localOrderRepoSingleton = new LocalOrderRepository();

export function getOrderRepository(): IOrderRepository {
  if (isFirebaseConfigured() && db !== null) {
    return new FirestoreOrderRepository(db);
  }
  return localOrderRepoSingleton;
}

export function getOrCreateLocalGuestUid(): string {
  if (typeof window !== 'undefined') {
    try {
      const existing = window.localStorage.getItem(LOCAL_GUEST_UID_STORAGE_KEY)?.trim();
      if (existing) {
        return existing;
      }
    } catch {
      // Ignorerer lesefeil i localStorage
    }
  }

  if (localGuestUidFallback) {
    return localGuestUidFallback;
  }

  const randomPart = Math.random().toString(36).slice(2, 10);
  const generated = `local-guest-${Date.now().toString(36)}-${randomPart}`;
  localGuestUidFallback = generated;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCAL_GUEST_UID_STORAGE_KEY, generated);
    } catch {
      // Ignorerer skrivefeil i localStorage
    }
  }

  return generated;
}

export async function resolveCheckoutOwnerUid(
  authInstance: Auth | null = auth,
  firebaseConfigured: boolean = isFirebaseConfigured(),
): Promise<string> {
  if (authInstance !== null) {
    return ensureAnonymousUserUid(authInstance);
  }
  if (firebaseConfigured && db !== null) {
    throw new Error('Firebase Auth er ikke tilgjengelig for utsjekk.');
  }
  return getOrCreateLocalGuestUid();
}
