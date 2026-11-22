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

export async function seedCatalog(productRepo: IProductRepository): Promise<SeedCatalogResult> {
  let created = 0;
  let skipped = 0;
  const products: Product[] = [];

  for (const item of STARTER_PRODUCTS) {
    const existing = item.id ? await productRepo.getById(item.id) : null;
    if (existing) {
      products.push(existing);
      skipped += 1;
      continue;
    }

    const createdProduct = await productRepo.create(item);
    products.push(createdProduct);
    created += 1;
  }

  return {
    created,
    skipped,
    products,
  };
}
