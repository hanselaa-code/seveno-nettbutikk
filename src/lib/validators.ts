import {
  ALLOWED_PAYMENT_PROVIDERS,
  CATEGORY_MAP,
  DEFAULT_PRODUCT_IMAGE,
} from '../types/domain';
import type {
  CategorySlug,
  CreateContactMessageInput,
  CreateOrderInput,
  CreateProductInput,
  PaymentProviderId,
} from '../types/domain';
import { slugify } from './format';

export const VALIDATION_LIMITS = {
  productSlugMin: 2,
  productSlugMax: 120,
  productTitleMin: 2,
  productTitleMax: 140,
  productDescriptionMin: 10,
  productDescriptionMax: 4000,
  productPriceMax: 10_000_000,
  productStockMax: 100_000,
  productSpecsMaxCount: 20,
  productSpecMaxLen: 200,
  imageUrlMax: 500,
  orderItemsMin: 1,
  orderItemsMax: 50,
  orderItemQtyMax: 100,
  customerNameMin: 2,
  customerNameMax: 100,
  streetMin: 2,
  streetMax: 200,
  cityMin: 1,
  cityMax: 100,
  paymentReferenceMin: 3,
  paymentReferenceMax: 120,
  contactSubjectMin: 2,
  contactSubjectMax: 150,
  contactMessageMin: 10,
  contactMessageMax: 3000,
} as const;

export interface ValidationResult<T> {
  valid: boolean;
  errors: Record<string, string>;
  value?: T;
}

export class ValidationError extends Error {
  readonly errors: Record<string, string>;

  constructor(message: string, errors: Record<string, string>) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export interface NormalizedProductInput {
  id?: string;
  slug: string;
  title: string;
  categorySlug: CategorySlug;
  description: string;
  priceNok: number;
  stock: number;
  imageUrl: string;
  specs: string[];
  active: boolean;
}

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const POSTAL_CODE_REGEX = /^\d{4}$/;
const NORWEGIAN_PHONE_REGEX = /^(?:\+47|0047)?\d{8}$/;
const SAFE_IMAGE_URL_REGEX = /^(?:\/images\/[a-zA-Z0-9/_-]+\.(?:svg|png|jpe?g|webp)|https:\/\/[^\s]+)$/;

export function isCategorySlug(value: unknown): value is CategorySlug {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_MAP, value);
}

export function isPaymentProviderId(value: unknown): value is PaymentProviderId {
  return typeof value === 'string' && (ALLOWED_PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254 || trimmed.includes('..')) {
    return false;
  }
  return EMAIL_REGEX.test(trimmed);
}

export function isValidNorwegianPostalCode(postalCode: string): boolean {
  if (typeof postalCode !== 'string') return false;
  return POSTAL_CODE_REGEX.test(postalCode.trim());
}

export function isValidNorwegianPhone(phone: string): boolean {
  if (typeof phone !== 'string') return false;
  const trimmed = phone.trim();
  if (trimmed.length < 8 || trimmed.length > 20) return false;
  const normalized = trimmed.replace(/[\s-]/g, '');
  return NORWEGIAN_PHONE_REGEX.test(normalized);
}

export function isValidImageUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.length < 1 || trimmed.length > VALIDATION_LIMITS.imageUrlMax || trimmed.includes('..')) {
    return false;
  }
  return SAFE_IMAGE_URL_REGEX.test(trimmed);
}

export function validateProductInput(
  input: CreateProductInput,
): ValidationResult<NormalizedProductInput> {
  const errors: Record<string, string> = {};

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < VALIDATION_LIMITS.productTitleMin || title.length > VALIDATION_LIMITS.productTitleMax) {
    errors.title = `Produkttittel må være mellom ${VALIDATION_LIMITS.productTitleMin} og ${VALIDATION_LIMITS.productTitleMax} tegn.`;
  }

  const rawSlug = typeof input.slug === 'string' && input.slug.trim().length > 0
    ? input.slug.trim()
    : slugify(title);
  if (
    rawSlug.length < VALIDATION_LIMITS.productSlugMin ||
    rawSlug.length > VALIDATION_LIMITS.productSlugMax ||
    !SLUG_REGEX.test(rawSlug)
  ) {
    errors.slug = `Slug må være mellom ${VALIDATION_LIMITS.productSlugMin} og ${VALIDATION_LIMITS.productSlugMax} tegn (små bokstaver, tall og bindestrek).`;
  }

  if (!isCategorySlug(input.categorySlug)) {
    errors.categorySlug = 'Ugyldig produktkategori.';
  }

  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (
    description.length < VALIDATION_LIMITS.productDescriptionMin ||
    description.length > VALIDATION_LIMITS.productDescriptionMax
  ) {
    errors.description = `Beskrivelse må være mellom ${VALIDATION_LIMITS.productDescriptionMin} og ${VALIDATION_LIMITS.productDescriptionMax} tegn.`;
  }

  if (
    typeof input.priceNok !== 'number' ||
    !Number.isFinite(input.priceNok) ||
    input.priceNok <= 0 ||
    input.priceNok > VALIDATION_LIMITS.productPriceMax
  ) {
    errors.priceNok = `Pris må være et positivt tall opptil ${VALIDATION_LIMITS.productPriceMax} kr.`;
  }

  if (
    typeof input.stock !== 'number' ||
    !Number.isInteger(input.stock) ||
    input.stock < 0 ||
    input.stock > VALIDATION_LIMITS.productStockMax
  ) {
    errors.stock = `Lagerbeholdning må være et heltall mellom 0 og ${VALIDATION_LIMITS.productStockMax}.`;
  }

  const rawImageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : '';
  const imageUrl = rawImageUrl.length > 0 ? rawImageUrl : DEFAULT_PRODUCT_IMAGE;
  if (!isValidImageUrl(imageUrl)) {
    errors.imageUrl = 'Bilde-URL må starte med https:// eller /images/ og ikke inneholde ugyldige tegn.';
  }

  const specsInput = input.specs ?? [];
  const specs: string[] = [];
  if (!Array.isArray(specsInput) || specsInput.length > VALIDATION_LIMITS.productSpecsMaxCount) {
    errors.specs = `Maksimalt ${VALIDATION_LIMITS.productSpecsMaxCount} spesifikasjoner er tillatt.`;
  } else {
    for (const item of specsInput) {
      if (typeof item !== 'string') {
        errors.specs = 'Alle spesifikasjoner må være tekststrenger.';
        break;
      }
      const trimmedSpec = item.trim();
      if (trimmedSpec.length < 1 || trimmedSpec.length > VALIDATION_LIMITS.productSpecMaxLen) {
        errors.specs = `Hver spesifikasjon må være mellom 1 og ${VALIDATION_LIMITS.productSpecMaxLen} tegn.`;
        break;
      }
      specs.push(trimmedSpec);
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: {},
    value: {
      ...(input.id ? { id: input.id.trim() } : {}),
      slug: rawSlug,
      title,
      categorySlug: input.categorySlug,
      description,
      priceNok: input.priceNok,
      stock: input.stock,
      imageUrl,
      specs,
      active: input.active ?? true,
    },
  };
}

export function validateOrderInput(input: CreateOrderInput): ValidationResult<CreateOrderInput> {
  const errors: Record<string, string> = {};

  const ownerUid = typeof input.ownerUid === 'string' ? input.ownerUid.trim() : '';
  if (ownerUid.length < 1 || ownerUid.length > 128) {
    errors.ownerUid = 'Bruker-ID mangler for bestillingen.';
  }

  const customerName = typeof input.customer?.name === 'string' ? input.customer.name.trim() : '';
  if (
    customerName.length < VALIDATION_LIMITS.customerNameMin ||
    customerName.length > VALIDATION_LIMITS.customerNameMax
  ) {
    errors['customer.name'] = `Navn må være mellom ${VALIDATION_LIMITS.customerNameMin} og ${VALIDATION_LIMITS.customerNameMax} tegn.`;
  }

  const customerEmail = typeof input.customer?.email === 'string' ? input.customer.email.trim() : '';
  if (!isValidEmail(customerEmail)) {
    errors['customer.email'] = 'Oppgi en gyldig e-postadresse.';
  }

  const customerPhone =
    typeof input.customer?.phone === 'string'
      ? input.customer.phone.replace(/\s/g, ' ').trim()
      : '';
  if (!isValidNorwegianPhone(customerPhone)) {
    errors['customer.phone'] = 'Oppgi et gyldig norsk telefonnummer (8 siffer).';
  }

  const street = typeof input.shippingAddress?.street === 'string' ? input.shippingAddress.street.trim() : '';
  if (street.length < VALIDATION_LIMITS.streetMin || street.length > VALIDATION_LIMITS.streetMax) {
    errors['shippingAddress.street'] = `Gateadresse må være mellom ${VALIDATION_LIMITS.streetMin} og ${VALIDATION_LIMITS.streetMax} tegn.`;
  }

  const postalCode =
    typeof input.shippingAddress?.postalCode === 'string' ? input.shippingAddress.postalCode.trim() : '';
  if (!isValidNorwegianPostalCode(postalCode)) {
    errors['shippingAddress.postalCode'] = 'Postnummer må bestå av nøyaktig 4 siffer.';
  }

  const city = typeof input.shippingAddress?.city === 'string' ? input.shippingAddress.city.trim() : '';
  if (city.length < VALIDATION_LIMITS.cityMin || city.length > VALIDATION_LIMITS.cityMax) {
    errors['shippingAddress.city'] = `Poststed må være mellom ${VALIDATION_LIMITS.cityMin} og ${VALIDATION_LIMITS.cityMax} tegn.`;
  }

  if (!isPaymentProviderId(input.paymentProvider)) {
    errors.paymentProvider = 'Ugyldig betalingsleverandør.';
  }

  let normalizedPaymentReference: string | undefined;
  if (input.paymentReference !== undefined) {
    if (typeof input.paymentReference !== 'string') {
      errors.paymentReference = 'Betalingsreferanse må være en tekststreng.';
    } else {
      const trimmedRef = input.paymentReference.trim();
      if (trimmedRef.length > 0) {
        if (
          trimmedRef.length < VALIDATION_LIMITS.paymentReferenceMin ||
          trimmedRef.length > VALIDATION_LIMITS.paymentReferenceMax
        ) {
          errors.paymentReference = `Betalingsreferanse må være mellom ${VALIDATION_LIMITS.paymentReferenceMin} og ${VALIDATION_LIMITS.paymentReferenceMax} tegn.`;
        } else {
          normalizedPaymentReference = trimmedRef;
        }
      }
    }
  }

  let normalizedPaymentStatus: 'paid_test' | 'pending_provider' | undefined;
  if (input.paymentStatus !== undefined) {
    if (input.paymentStatus !== 'paid_test' && input.paymentStatus !== 'pending_provider') {
      errors.paymentStatus =
        'Ugyldig betalingsstatus ved opprettelse av bestilling (kun paid_test eller pending_provider er tillatt).';
    } else {
      normalizedPaymentStatus = input.paymentStatus;
    }
  }

  if (
    !Array.isArray(input.items) ||
    input.items.length < VALIDATION_LIMITS.orderItemsMin ||
    input.items.length > VALIDATION_LIMITS.orderItemsMax
  ) {
    errors.items = `Bestillingen må inneholde mellom ${VALIDATION_LIMITS.orderItemsMin} og ${VALIDATION_LIMITS.orderItemsMax} varelinjer.`;
  } else {
    const seenIds = new Set<string>();
    const normalizedItems: Array<{ productId: string; quantity: number }> = [];

    for (const item of input.items) {
      const pid = typeof item?.productId === 'string' ? item.productId.trim() : '';
      if (pid.length < 1 || pid.length > 120) {
        errors.items = 'Ugyldig produkt-ID i handlekurven.';
        break;
      }
      if (seenIds.has(pid)) {
        errors.items = 'Duplikat produkt-ID i samme bestilling er ikke tillatt.';
        break;
      }
      if (
        typeof item.quantity !== 'number' ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > VALIDATION_LIMITS.orderItemQtyMax
      ) {
        errors.items = `Antall per produkt må være et heltall mellom 1 og ${VALIDATION_LIMITS.orderItemQtyMax}.`;
        break;
      }
      seenIds.add(pid);
      normalizedItems.push({ productId: pid, quantity: item.quantity });
    }

    if (Object.keys(errors).length === 0) {
      return {
        valid: true,
        errors: {},
        value: {
          ownerUid,
          customer: {
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
          },
          shippingAddress: {
            street,
            postalCode,
            city,
          },
          items: normalizedItems,
          paymentProvider: input.paymentProvider,
          ...(normalizedPaymentReference ? { paymentReference: normalizedPaymentReference } : {}),
          ...(normalizedPaymentStatus ? { paymentStatus: normalizedPaymentStatus } : {}),
        },
      };
    }
  }

  return { valid: false, errors };
}

export function validateContactMessageInput(
  input: CreateContactMessageInput,
): ValidationResult<CreateContactMessageInput> {
  const errors: Record<string, string> = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < VALIDATION_LIMITS.customerNameMin || name.length > VALIDATION_LIMITS.customerNameMax) {
    errors.name = `Navn må være mellom ${VALIDATION_LIMITS.customerNameMin} og ${VALIDATION_LIMITS.customerNameMax} tegn.`;
  }

  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (!isValidEmail(email)) {
    errors.email = 'Oppgi en gyldig e-postadresse.';
  }

  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  if (subject.length < VALIDATION_LIMITS.contactSubjectMin || subject.length > VALIDATION_LIMITS.contactSubjectMax) {
    errors.subject = `Emne må være mellom ${VALIDATION_LIMITS.contactSubjectMin} og ${VALIDATION_LIMITS.contactSubjectMax} tegn.`;
  }

  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message.length < VALIDATION_LIMITS.contactMessageMin || message.length > VALIDATION_LIMITS.contactMessageMax) {
    errors.message = `Melding må være mellom ${VALIDATION_LIMITS.contactMessageMin} og ${VALIDATION_LIMITS.contactMessageMax} tegn.`;
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: {},
    value: {
      name,
      email,
      subject,
      message,
    },
  };
}
