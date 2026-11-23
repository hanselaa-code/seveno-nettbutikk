import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  const collections = new Map<string, Map<string, Record<string, unknown>>>();
  let autoId = 0;

  const ensureCol = (name: string) => {
    let col = collections.get(name);
    if (!col) {
      col = new Map();
      collections.set(name, col);
    }
    return col;
  };

  return {
    collections,
    ensureCol,
    nextId: () => {
      autoId += 1;
      return `auto-${autoId}`;
    },
    reset: () => {
      collections.clear();
      autoId = 0;
    },
    getDocCalls: [] as Array<{ col: string; id: string }>,
    setDocCalls: [] as Array<{ col: string; id: string; data: Record<string, unknown> }>,
    updateDocCalls: [] as Array<{ col: string; id: string; data: Record<string, unknown> }>,
  };
});

const SERVER_TIMESTAMP_SENTINEL = { __isServerTimestamp: true };

function resolveTimestamps(data: Record<string, unknown>): Record<string, unknown> {
  const fixedDate = new Date('2026-11-22T10:00:00.000Z');
  const fakeTimestamp = { toDate: () => fixedDate };
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    result[k] = v === SERVER_TIMESTAMP_SENTINEL ? fakeTimestamp : v;
  }
  return result;
}

vi.mock('firebase/firestore', () => {
  return {
    collection: (_db: unknown, name: string) => ({ __type: 'collection', name }),
    doc: (parent: { __type?: string; name?: string }, id?: string) => {
      if (parent && parent.__type === 'collection' && parent.name) {
        return { __type: 'doc', col: parent.name, id: id ?? mockState.nextId() };
      }
      return { __type: 'doc', col: id ?? 'unknown', id: '' };
    },
    // Overload support for doc(db, 'collection', id)
    getDoc: async (ref: { col: string; id: string }) => {
      mockState.getDocCalls.push({ col: ref.col, id: ref.id });
      const data = mockState.ensureCol(ref.col).get(ref.id);
      return {
        id: ref.id,
        exists: () => Boolean(data),
        data: () => data,
      };
    },
    getDocs: async (q: {
      col: string;
      filters: Array<{ field: string; value: unknown }>;
      sort?: { field: string; dir: 'asc' | 'desc' };
      max?: number;
    }) => {
      const col = mockState.ensureCol(q.col);
      let entries = Array.from(col.entries());
      for (const f of q.filters) {
        entries = entries.filter(([, d]) => d[f.field] === f.value);
      }
      if (q.sort) {
        const { field, dir } = q.sort;
        entries.sort(([, a], [, b]) => {
          const av = String(a[field] ?? '');
          const bv = String(b[field] ?? '');
          return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (typeof q.max === 'number') {
        entries = entries.slice(0, q.max);
      }
      const docs = entries.map(([id, data]) => ({
        id,
        exists: () => true,
        data: () => data,
      }));
      return { empty: docs.length === 0, docs };
    },
    setDoc: async (ref: { col: string; id: string }, data: Record<string, unknown>) => {
      mockState.setDocCalls.push({ col: ref.col, id: ref.id, data });
      mockState.ensureCol(ref.col).set(ref.id, resolveTimestamps(data));
    },
    updateDoc: async (ref: { col: string; id: string }, data: Record<string, unknown>) => {
      mockState.updateDocCalls.push({ col: ref.col, id: ref.id, data });
      const col = mockState.ensureCol(ref.col);
      const existing = col.get(ref.id) ?? {};
      col.set(ref.id, { ...existing, ...resolveTimestamps(data) });
    },
    deleteDoc: async (ref: { col: string; id: string }) => {
      mockState.ensureCol(ref.col).delete(ref.id);
    },
    where: (field: string, _op: string, value: unknown) => ({
      __type: 'where',
      field,
      value,
    }),
    orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => ({
      __type: 'orderBy',
      field,
      dir,
    }),
    limit: (max: number) => ({ __type: 'limit', max }),
    query: (
      colRef: { name: string },
      ...constraints: Array<
        | { __type: 'where'; field: string; value: unknown }
        | { __type: 'orderBy'; field: string; dir: 'asc' | 'desc' }
        | { __type: 'limit'; max: number }
      >
    ) => {
      const filters = constraints
        .filter((c): c is { __type: 'where'; field: string; value: unknown } => c.__type === 'where')
        .map((c) => ({ field: c.field, value: c.value }));
      const sort = constraints.find(
        (c): c is { __type: 'orderBy'; field: string; dir: 'asc' | 'desc' } => c.__type === 'orderBy',
      );
      const lim = constraints.find((c): c is { __type: 'limit'; max: number } => c.__type === 'limit');
      return {
        col: colRef.name,
        filters,
        sort: sort ? { field: sort.field, dir: sort.dir } : undefined,
        max: lim?.max,
      };
    },
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
    connectFirestoreEmulator: vi.fn(),
    getFirestore: vi.fn(),
  };
});

import * as firestoreMod from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
  auth,
  db,
  firebaseApp,
  getAuthInstance,
  getDb,
  getFirebaseApp,
  isFirebaseConfigured,
} from '../../src/lib/firebase';
import { ValidationError } from '../../src/lib/validators';
import { FirestoreContactRepository } from '../../src/repositories/contactRepository';
import { FirestoreOrderRepository } from '../../src/repositories/orderRepository';
import { FirestoreProductRepository } from '../../src/repositories/productRepository';
import { DEFAULT_PRODUCT_IMAGE } from '../../src/types/domain';

// Patch doc mock to handle both doc(collectionRef) and doc(db, collectionName, id)
vi.spyOn(firestoreMod, 'doc').mockImplementation((...args: unknown[]) => {
  if (args.length === 1) {
    const colRef = args[0] as { name: string };
    return { __type: 'doc', col: colRef.name, id: mockState.nextId() } as never;
  }
  const colName = String(args[1]);
  const docId = String(args[2]);
  return { __type: 'doc', col: colName, id: docId } as never;
});

describe('Firebase bootstrap & Firestore repositories (M1)', () => {
  const fakeDb = {} as Firestore;

  beforeEach(() => {
    mockState.reset();
    mockState.getDocCalls.length = 0;
    mockState.setDocCalls.length = 0;
    mockState.updateDocCalls.length = 0;
  });

  it('imports src/lib/firebase.ts safely without env vars and throws clear errors on getDb/getAuth', () => {
    expect(isFirebaseConfigured()).toBe(false);
    expect(firebaseApp).toBeNull();
    expect(db).toBeNull();
    expect(auth).toBeNull();
    expect(() => getFirebaseApp()).toThrow(/ikke konfigurert/i);
    expect(() => getDb()).toThrow(/ikke konfigurert/i);
    expect(() => getAuthInstance()).toThrow(/ikke konfigurert/i);
  });

  it('FirestoreProductRepository creates, updates, lists, and deletes without storing id inside doc fields', async () => {
    const repo = new FirestoreProductRepository(fakeDb);

    const created = await repo.create({
      id: 'army-sekk',
      title: 'Army sekk',
      categorySlug: 'seveno-living',
      description: 'Slitesterk ryggsekk i vokset kanvas med bronsedetaljer.',
      priceNok: 1890,
      stock: 10,
    });

    expect(created.id).toBe('army-sekk');
    expect(created.slug).toBe('army-sekk');
    expect(created.categoryName).toBe('Seveno living');
    expect(created.imageUrl).toBe(DEFAULT_PRODUCT_IMAGE);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Ensure id was NOT written inside Firestore document fields and serverTimestamp was used
    const rawWrite = mockState.setDocCalls[0]?.data;
    expect(rawWrite).toBeDefined();
    expect('id' in (rawWrite ?? {})).toBe(false);
    expect(rawWrite?.createdAt).toBe(SERVER_TIMESTAMP_SENTINEL);
    expect(rawWrite?.updatedAt).toBe(SERVER_TIMESTAMP_SENTINEL);

    // Inactive product should be excluded from listActive/listByCategory
    await repo.create({
      id: 'draft-item',
      title: 'Utkast produkt',
      categorySlug: 'seveno-home',
      description: 'Dette produktet er foreløpig skjult i katalogen.',
      priceNok: 499,
      stock: 5,
      active: false,
    });

    expect(await repo.listAll()).toHaveLength(2);
    expect(await repo.listActive()).toHaveLength(1);
    expect(await repo.listByCategory('seveno-living')).toHaveLength(1);
    expect(await repo.listByCategory('seveno-home')).toHaveLength(0);
    expect((await repo.getBySlug('army-sekk'))?.id).toBe('army-sekk');

    // Update preserves createdAt, updates categoryName, and canonicalizes trimmed ID
    const updated = await repo.update('  army-sekk  ', {
      categorySlug: 'seveno-home',
      priceNok: 1990,
    });
    expect(updated.id).toBe('army-sekk');
    expect(updated.categoryName).toBe('Seveno home');
    expect(updated.priceNok).toBe(1990);
    expect(mockState.updateDocCalls[0]?.id).toBe('army-sekk');
    expect(mockState.updateDocCalls[0]?.data.createdAt).toBeUndefined();
    expect(mockState.updateDocCalls[0]?.data.updatedAt).toBe(SERVER_TIMESTAMP_SENTINEL);

    // Rejects invalid product
    await expect(
      repo.create({
        title: 'X',
        categorySlug: 'seveno-living',
        description: 'Kort',
        priceNok: -10,
        stock: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await repo.delete('draft-item');
    expect(await repo.listAll()).toHaveLength(1);
  });

  it('FirestoreProductRepository.getBySlug resolves auto-ID active products and never leaks inactive products or fails on permission-denied getById', async () => {
    const repo = new FirestoreProductRepository(fakeDb);

    // 1. Auto-ID product (id !== slug)
    const autoProduct = await repo.create({
      title: 'Nordisk ullpledd',
      slug: 'nordisk-ullpledd',
      categorySlug: 'seveno-home',
      description: 'Varmt ullpledd i ren nordisk ull for sofa og uteplass.',
      priceNok: 1290,
      stock: 8,
    });
    expect(autoProduct.id).not.toBe('nordisk-ullpledd');

    // Even when getById(slug) returns null (default) or throws permission-denied
    const getByIdSpy = vi.spyOn(repo, 'getById').mockRejectedValueOnce(
      Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
      }),
    );
    const foundAuto = await repo.getBySlug('nordisk-ullpledd');
    expect(foundAuto?.id).toBe(autoProduct.id);
    expect(foundAuto?.slug).toBe('nordisk-ullpledd');
    // Slug query runs first so getById is not even needed for active auto-ID products
    expect(getByIdSpy).not.toHaveBeenCalled();
    getByIdSpy.mockRestore();

    // Missing slug fallback where getById throws permission-denied must return null cleanly
    const getDocSpy = vi.spyOn(firestoreMod, 'getDoc').mockRejectedValueOnce(
      Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
      }),
    );
    expect(await repo.getBySlug('finnes-ikke')).toBeNull();
    expect(getDocSpy).toHaveBeenCalledTimes(1);
    getDocSpy.mockRestore();

    // 2. Product with id === slug and active: false must return null
    await repo.create({
      id: 'skjult-produkt',
      slug: 'skjult-produkt',
      title: 'Skjult produkt',
      categorySlug: 'seveno-living',
      description: 'Et produkt som ikke er aktivt i nettbutikken ennå.',
      priceNok: 799,
      stock: 4,
      active: false,
    });
    expect(await repo.getBySlug('skjult-produkt')).toBeNull();
  });

  it('FirestoreProductRepository.getById and getBySlug return null cleanly for empty or slash-containing inputs without querying Firestore', async () => {
    const repo = new FirestoreProductRepository(fakeDb);
    const getDocSpy = vi.spyOn(firestoreMod, 'getDoc');
    const getDocsSpy = vi.spyOn(firestoreMod, 'getDocs');

    expect(await repo.getBySlug('')).toBeNull();
    expect(await repo.getBySlug('   ')).toBeNull();
    expect(await repo.getBySlug('foo/bar')).toBeNull();
    expect(await repo.getById('')).toBeNull();
    expect(await repo.getById('   ')).toBeNull();
    expect(await repo.getById('foo/bar')).toBeNull();

    expect(getDocSpy).not.toHaveBeenCalled();
    expect(getDocsSpy).not.toHaveBeenCalled();

    getDocSpy.mockRestore();
    getDocsSpy.mockRestore();
  });

  it('FirestoreOrderRepository recalculates canonical totals from products without mutating product stock', async () => {
    const productRepo = new FirestoreProductRepository(fakeDb);
    const orderRepo = new FirestoreOrderRepository(fakeDb, productRepo);

    await productRepo.create({
      id: 'skobeholder',
      title: 'Akryl gjennomsiktig skobeholder',
      categorySlug: 'seveno-home',
      description: 'Krystallklar oppbevaringsboks i optisk akryl for sko.',
      priceNok: 349,
      stock: 5,
    });

    const order = await orderRepo.create({
      ownerUid: 'cust-1',
      customer: {
        name: 'Ola Nordmann',
        email: 'ola@example.no',
        phone: '91234567',
      },
      shippingAddress: {
        street: 'Storgata 10',
        postalCode: '0155',
        city: 'Oslo',
      },
      items: [{ productId: 'skobeholder', quantity: 2 }],
      paymentProvider: 'vipps',
    });

    // 2 * 349 = 698 (< 1500 => +99 shipping = 797 total, 20% MVA = 159)
    expect(order.orderNumber).toMatch(/^SEV-\d{4}-[A-Z0-9]{8}$/);
    expect(order.subtotalNok).toBe(698);
    expect(order.shippingNok).toBe(99);
    expect(order.totalNok).toBe(797);
    expect(order.mvaNok).toBe(159);
    expect(order.paymentStatus).toBe('pending_provider');
    expect(order.status).toBe('confirmed');

    // Product stock must NOT be mutated by order creation
    const productAfter = await productRepo.getById('skobeholder');
    expect(productAfter?.stock).toBe(5);
    expect(mockState.updateDocCalls).toHaveLength(0);

    // Rejects over-stock order
    await expect(
      orderRepo.create({
        ownerUid: 'cust-1',
        customer: { name: 'Ola Nordmann', email: 'ola@example.no', phone: '91234567' },
        shippingAddress: { street: 'Storgata 10', postalCode: '0155', city: 'Oslo' },
        items: [{ productId: 'skobeholder', quantity: 6 }],
        paymentProvider: 'test_order',
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await orderRepo.listByOwner('cust-1')).toHaveLength(1);
    expect((await orderRepo.getById(order.id))?.orderNumber).toBe(order.orderNumber);

    const writesBeforeInvalid = mockState.setDocCalls.length;
    await expect(
      orderRepo.create({
        ownerUid: 'cust-1',
        customer: { name: 'Ola Nordmann', email: 'ola@example.no', phone: '91234567' },
        shippingAddress: { street: 'Storgata 10', postalCode: '0155', city: 'Oslo' },
        items: [{ productId: 'skobeholder', quantity: 1 }],
        paymentProvider: 'vipps',
        paymentReference: 'ab',
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      orderRepo.create({
        ownerUid: 'cust-1',
        customer: { name: 'Ola Nordmann', email: 'ola@example.no', phone: '91234567' },
        shippingAddress: { street: 'Storgata 10', postalCode: '0155', city: 'Oslo' },
        items: [{ productId: 'skobeholder', quantity: 1 }],
        paymentProvider: 'vipps',
        paymentReference: 'x'.repeat(121),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      orderRepo.create({
        ownerUid: 'cust-1',
        customer: { name: 'Ola Nordmann', email: 'ola@example.no', phone: '91234567' },
        shippingAddress: { street: 'Storgata 10', postalCode: '0155', city: 'Oslo' },
        items: [{ productId: 'skobeholder', quantity: 1 }],
        paymentProvider: 'vipps',
        paymentStatus: 'authorized',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockState.setDocCalls.length).toBe(writesBeforeInvalid);
  });

  it('FirestoreContactRepository creates validated message WITHOUT calling getDoc() readback', async () => {
    const contactRepo = new FirestoreContactRepository(fakeDb);

    const saved = await contactRepo.create({
      name: 'Ingrid Hansen',
      email: 'ingrid@example.no',
      subject: 'Leveringstid på pergola',
      message: 'Hei! Hvor lang leveringstid er det til Bergen på pergola?',
    });

    expect(saved.status).toBe('new');
    expect(saved.id).toBeTruthy();
    expect(mockState.getDocCalls).toHaveLength(0);

    const rawContactWrite = mockState.setDocCalls[0]?.data;
    expect('id' in (rawContactWrite ?? {})).toBe(false);
    expect(rawContactWrite?.createdAt).toBe(SERVER_TIMESTAMP_SENTINEL);

    expect(await contactRepo.listAll()).toHaveLength(1);

    await expect(
      contactRepo.create({
        name: 'I',
        email: 'ugyldig',
        subject: 'A',
        message: 'Kort',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('FirestoreContactRepository.create and FirestoreOrderRepository.create fail fast when navigator.onLine is false or setDoc stalls', async () => {
    const productRepo = new FirestoreProductRepository(fakeDb);
    await productRepo.create({
      id: 'offline-prod',
      title: 'Offline Testprodukt',
      categorySlug: 'seveno-living',
      description: 'Testprodukt for offline og timeout-verifisering.',
      priceNok: 500,
      stock: 5,
    });

    const contactRepo = new FirestoreContactRepository(fakeDb);
    const orderRepo = new FirestoreOrderRepository(fakeDb, productRepo);

    const onLineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);

    try {
      await expect(
        contactRepo.create({
          name: 'Ingrid Hansen',
          email: 'ingrid@example.no',
          subject: 'Offline test',
          message: 'Tester at offline innsending ikke henger evig.',
        }),
      ).rejects.toThrow(/internettforbindelse/i);

      await expect(
        orderRepo.create({
          ownerUid: 'cust-offline',
          customer: { name: 'Ola Nordmann', email: 'ola@example.no', phone: '91234567' },
          shippingAddress: { street: 'Storgata 10', postalCode: '0155', city: 'Oslo' },
          items: [{ productId: 'offline-prod', quantity: 1 }],
          paymentProvider: 'test_order',
        }),
      ).rejects.toThrow(/internettforbindelse/i);
    } finally {
      onLineSpy.mockRestore();
    }

    vi.useFakeTimers();
    const setDocSpy = vi
      .spyOn(firestoreMod, 'setDoc')
      .mockImplementation(() => new Promise<void>(() => undefined));

    try {
      const contactPromise = contactRepo.create({
        name: 'Ingrid Hansen',
        email: 'ingrid@example.no',
        subject: 'Timeout test',
        message: 'Tester at hengende setDoc avbrytes etter tidsavbrudd.',
      });
      const contactErrorPromise = contactPromise.catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(10_500);
      const contactErr = await contactErrorPromise;
      expect(contactErr).toBeInstanceOf(Error);
      expect((contactErr as Error).message).toMatch(/tok for lang tid/i);

      const orderPromise = orderRepo.create({
        ownerUid: 'cust-timeout',
        customer: { name: 'Ola Nordmann', email: 'ola@example.no', phone: '91234567' },
        shippingAddress: { street: 'Storgata 10', postalCode: '0155', city: 'Oslo' },
        items: [{ productId: 'offline-prod', quantity: 1 }],
        paymentProvider: 'test_order',
      });
      const orderErrorPromise = orderPromise.catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(10_500);
      const orderErr = await orderErrorPromise;
      expect(orderErr).toBeInstanceOf(Error);
      expect((orderErr as Error).message).toMatch(/tok for lang tid/i);
    } finally {
      setDocSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
