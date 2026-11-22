import { describe, expect, it } from 'vitest';
import type { IProductRepository } from '../../src/repositories/productRepository';
import { STARTER_PRODUCTS, seedCatalog } from '../../src/repositories/seedCatalog';
import { CATEGORY_MAP } from '../../src/types/domain';
import type {
  CategorySlug,
  CreateProductInput,
  Product,
  UpdateProductInput,
} from '../../src/types/domain';

function createInMemoryProductRepo(): IProductRepository {
  const store = new Map<string, Product>();

  return {
    async listAll() {
      return Array.from(store.values());
    },
    async listActive() {
      return Array.from(store.values()).filter((p) => p.active);
    },
    async listByCategory(categorySlug: CategorySlug) {
      return Array.from(store.values()).filter((p) => p.active && p.categorySlug === categorySlug);
    },
    async getById(id: string) {
      return store.get(id) ?? null;
    },
    async getBySlug(slug: string) {
      return Array.from(store.values()).find((p) => p.slug === slug) ?? null;
    },
    async create(input: CreateProductInput) {
      const id = input.id ?? `id-${store.size + 1}`;
      const now = new Date().toISOString();
      const product: Product = {
        id,
        slug: input.slug ?? id,
        title: input.title,
        categorySlug: input.categorySlug,
        categoryName: CATEGORY_MAP[input.categorySlug].name,
        description: input.description,
        priceNok: input.priceNok,
        stock: input.stock,
        imageUrl: input.imageUrl ?? '/images/products/seveno-default.svg',
        specs: input.specs ?? [],
        active: input.active ?? true,
        createdAt: now,
        updatedAt: now,
      };
      store.set(id, product);
      return product;
    },
    async update(id: string, input: UpdateProductInput) {
      const existing = store.get(id);
      if (!existing) throw new Error('Not found');
      const updated: Product = {
        ...existing,
        ...input,
        categoryName: input.categorySlug
          ? CATEGORY_MAP[input.categorySlug].name
          : existing.categoryName,
        updatedAt: new Date().toISOString(),
      };
      store.set(id, updated);
      return updated;
    },
    async delete(id: string) {
      store.delete(id);
    },
  };
}

describe('seedCatalog (M1)', () => {
  it('seeds all 3 starter products across all 3 categories idempotently without overwriting edits', async () => {
    const repo = createInMemoryProductRepo();

    const firstRun = await seedCatalog(repo);
    expect(firstRun.created).toBe(3);
    expect(firstRun.skipped).toBe(0);
    expect(firstRun.products).toHaveLength(3);

    expect(STARTER_PRODUCTS.map((p) => p.id)).toEqual([
      'army-sekk',
      'akryl-gjennomsiktig-skobeholder',
      'pergola',
    ]);

    const living = await repo.listByCategory('seveno-living');
    const home = await repo.listByCategory('seveno-home');
    const outdoor = await repo.listByCategory('seveno-outdoor');
    expect(living[0]?.title).toBe('Army sekk');
    expect(home[0]?.title).toBe('Akryl gjennomsiktig skobeholder');
    expect(outdoor[0]?.title).toBe('Pergola');

    // Simulate admin modifying a starter product price
    await repo.update('army-sekk', { priceNok: 2150 });

    const secondRun = await seedCatalog(repo);
    expect(secondRun.created).toBe(0);
    expect(secondRun.skipped).toBe(3);

    const armySekk = await repo.getById('army-sekk');
    expect(armySekk?.priceNok).toBe(2150);
    expect(await repo.listAll()).toHaveLength(3);
  });
});
