import { slugify } from '../lib/format';
import { CATEGORY_MAP, DEFAULT_PRODUCT_IMAGE } from '../types/domain';
import type { CreateProductInput, Product } from '../types/domain';
import type { IProductRepository } from './productRepository';

export interface SeedCatalogResult {
  created: number;
  skipped: number;
  products: Product[];
}

export const STARTER_PRODUCTS: readonly CreateProductInput[] = [
  {
    id: 'army-sekk',
    slug: 'army-sekk',
    title: 'Army sekk',
    categorySlug: 'seveno-living',
    description:
      'Slitesterk og stilren nordisk ryggsekk i vokset kanvas og forsterket bunn. Designet for pendling, helgeturer og aktiv hverdag med egen polstret laptop-lomme og bronsedetaljer.',
    priceNok: 1890,
    stock: 18,
    imageUrl: '/images/products/army-sekk.svg',
    specs: [
      'Volum: 28 liter',
      'Materiale: Vokset kanvas og 1000D nylon',
      'PC-lomme: Opptil 16 tommer',
      'Vannavstøtende: Ja (IPX4)',
      'Farge: Oliven og kullsort med bronsedetaljer',
    ],
    active: true,
  },
  {
    id: 'akryl-gjennomsiktig-skobeholder',
    slug: 'akryl-gjennomsiktig-skobeholder',
    title: 'Akryl gjennomsiktig skobeholder',
    categorySlug: 'seveno-home',
    description:
      'Krystallklar og stabelbar oppbevaringsboks i 4 mm optisk akryl som beskytter skoene dine mot støv samtidig som de vises frem i entré eller garderobe. Utstyrt med magnetisk frontdør.',
    priceNok: 349,
    stock: 42,
    imageUrl: '/images/products/skobeholder.svg',
    specs: [
      'Mål: 36 × 28 × 22 cm',
      'Materiale: 4 mm optisk akryl',
      'Kapasitet: Opptil str. 47',
      'Lukking: Dobbel neodymmagnet',
      'Stabelbar: Ja (låsbar topp og bunn)',
    ],
    active: true,
  },
  {
    id: 'pergola',
    slug: 'pergola',
    title: 'Pergola',
    categorySlug: 'seveno-outdoor',
    description:
      'Arkitektonisk pergola i pulverlakkert aluminium med trinnløst justerbare taklameller og skjult drenering i stolpene. Skaper en lun og værbestandig uteplass gjennom hele den nordiske sesongen.',
    priceNok: 24900,
    stock: 6,
    imageUrl: '/images/products/pergola.svg',
    specs: [
      'Mål: 300 × 400 × 250 cm',
      'Ramme: Pulverlakkert aluminium',
      'Tak: 0–135° justerbare lameller',
      'Drenering: Integrert i stolper',
      'Snølast: Opptil 120 kg/m²',
    ],
    active: true,
  },
] as const;

export function getStarterProducts(timestamp: string = new Date().toISOString()): Product[] {
  return STARTER_PRODUCTS.map((item) => {
    const resolvedId = item.id ?? slugify(item.title);
    return {
      id: resolvedId,
      slug: item.slug ?? resolvedId,
      title: item.title,
      categorySlug: item.categorySlug,
      categoryName: CATEGORY_MAP[item.categorySlug].name,
      description: item.description,
      priceNok: item.priceNok,
      stock: item.stock,
      imageUrl: item.imageUrl ?? DEFAULT_PRODUCT_IMAGE,
      specs: item.specs ? [...item.specs] : [],
      active: item.active ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}

const CATALOG_INTENTIONALLY_EMPTIED_KEY = 'seveno_catalog_emptied_v1';

export function isCatalogIntentionallyEmptied(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(CATALOG_INTENTIONALLY_EMPTIED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markCatalogIntentionallyEmptied(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(CATALOG_INTENTIONALLY_EMPTIED_KEY, 'true');
  } catch {
    // Ignore storage quota or access errors
  }
}

export function clearCatalogIntentionallyEmptied(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(CATALOG_INTENTIONALLY_EMPTIED_KEY);
  } catch {
    // Ignore storage access errors
  }
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

function isAlreadyExistsOrPermissionDeniedError(error: unknown): boolean {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  return (
    isPermissionDeniedError(error) ||
    code === 'already-exists' ||
    code.endsWith('/already-exists') ||
    (error instanceof Error && /already-exists/i.test(error.message))
  );
}

const inFlightSeedMap = new WeakMap<IProductRepository, Promise<SeedCatalogResult>>();

async function runSeedCatalog(productRepo: IProductRepository): Promise<SeedCatalogResult> {
  let created = 0;
  let skipped = 0;
  const products: Product[] = [];

  for (const item of STARTER_PRODUCTS) {
    let existing: Product | null = null;
    try {
      existing = item.id ? await productRepo.getById(item.id) : null;
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        // Non-admin read of an existing deactivated starter product is denied by Firestore rules.
        skipped += 1;
        continue;
      }
      throw error;
    }

    if (existing) {
      products.push(existing);
      skipped += 1;
      continue;
    }

    try {
      const createdProduct = await productRepo.create(item);
      products.push(createdProduct);
      created += 1;
    } catch (createError) {
      if (isAlreadyExistsOrPermissionDeniedError(createError) && item.id) {
        let existingAfterRace: Product | null = null;
        try {
          existingAfterRace = await productRepo.getById(item.id);
        } catch {
          existingAfterRace = null;
        }
        if (existingAfterRace !== null) {
          products.push(existingAfterRace);
          skipped += 1;
          continue;
        }
      }
      throw createError;
    }
  }

  return {
    created,
    skipped,
    products,
  };
}

export async function seedCatalog(productRepo: IProductRepository): Promise<SeedCatalogResult> {
  const existingFlight = inFlightSeedMap.get(productRepo);
  if (existingFlight) {
    return existingFlight;
  }

  const promise = runSeedCatalog(productRepo).finally(() => {
    if (inFlightSeedMap.get(productRepo) === promise) {
      inFlightSeedMap.delete(productRepo);
    }
  });
  inFlightSeedMap.set(productRepo, promise);
  return promise;
}

export interface EnsureAdminColdStartSeedResult {
  seeded: boolean;
  products: Product[];
}

const inFlightAdminSeedMap = new WeakMap<
  IProductRepository,
  Promise<EnsureAdminColdStartSeedResult>
>();

async function runEnsureAdminColdStartSeed(
  productRepo: IProductRepository,
): Promise<EnsureAdminColdStartSeedResult> {
  if (isCatalogIntentionallyEmptied()) {
    return { seeded: false, products: [] };
  }

  const existing = await productRepo.listAll();
  if (existing.length > 0) {
    clearCatalogIntentionallyEmptied();
    return { seeded: false, products: existing };
  }

  const seedResult = await seedCatalog(productRepo);
  if (seedResult.created > 0) {
    clearCatalogIntentionallyEmptied();
    const seededList = await productRepo.listAll();
    return {
      seeded: true,
      products: seededList.length > 0 ? seededList : seedResult.products,
    };
  }

  return { seeded: false, products: seedResult.products };
}

export async function ensureAdminColdStartSeed(
  productRepo: IProductRepository,
): Promise<EnsureAdminColdStartSeedResult> {
  const existingFlight = inFlightAdminSeedMap.get(productRepo);
  if (existingFlight) {
    return existingFlight;
  }

  const promise = runEnsureAdminColdStartSeed(productRepo).finally(() => {
    if (inFlightAdminSeedMap.get(productRepo) === promise) {
      inFlightAdminSeedMap.delete(productRepo);
    }
  });
  inFlightAdminSeedMap.set(productRepo, promise);
  return promise;
}
